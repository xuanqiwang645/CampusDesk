import Foundation
import CoreFoundation
import PDFKit
import Vision
import ImageIO
import Darwin

/// Parses only bytes already downloaded by CampusDesk. No network requests,
/// credential access, Office automation, macros, or external XML entities.
enum TeamsAttachmentParser {
    static let maximumFileBytes = 25 * 1024 * 1024
    static let maximumTextCharacters = 80_000
    private static let worker = DispatchQueue(label: "CampusDesk.attachments", qos: .utility)

    /// Work is serialized off the UI thread; completion is delivered on main.
    static func parse(data: Data, mimeType: String, name: String,
                      completion: @escaping ([String: Any]) -> Void) {
        worker.async {
            let result = autoreleasepool { parseSynchronously(data: data, mimeType: mimeType, name: name) }
            DispatchQueue.main.async { completion(result) }
        }
    }

    static func parse(fileURL: URL, mimeType: String, name: String? = nil,
                      completion: @escaping ([String: Any]) -> Void) {
        worker.async {
            let result: [String: Any]
            do {
                guard fileURL.isFileURL else { throw ParseError.invalidFile }
                let info = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                guard info.isRegularFile == true, info.isSymbolicLink != true else { throw ParseError.invalidFile }
                guard let size = info.fileSize, size <= maximumFileBytes else { throw ParseError.tooLarge }
                let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
                result = autoreleasepool { parseSynchronously(data: data, mimeType: mimeType, name: name ?? fileURL.lastPathComponent) }
            } catch { result = failed(error) }
            DispatchQueue.main.async { completion(result) }
        }
    }

    private enum ParseError: Error {
        case tooLarge, invalidFile, invalidArchive, archiveLimit, invalidXML, decoding, encryptedPDF, malformedPDF, extraction
        var message: String {
            switch self {
            case .tooLarge: return "附件超过 25 MiB 本机解析上限，尚未读取正文"
            case .invalidFile: return "附件不是可读取的普通本地文件"
            case .invalidArchive: return "Office 文件结构无效、加密，或包含不安全的归档条目"
            case .archiveLimit: return "Office 文件解压内容超过安全解析上限，尚未完整读取"
            case .invalidXML: return "Office 文件正文 XML 无效或含不受支持的实体声明"
            case .decoding: return "附件文字编码无法识别，尚未读取正文"
            case .encryptedPDF: return "PDF 已加密，需要先在本机解锁后才能读取"
            case .malformedPDF: return "PDF 文件无法打开，尚未读取正文"
            case .extraction: return "本机解析未完成，尚未确认附件正文"
            }
        }
    }
    private static func failed(_ error: Error) -> [String: Any] {
        ["status": "error", "text": "", "truncated": false,
         "error": (error as? ParseError)?.message ?? "本机附件解析失败，尚未读取正文"]
    }
    private static func result(_ text: String, parser: String, truncated: Bool = false, partial: Bool = false,
                               detail: String = "", metadata: [String: Any] = [:]) -> [String: Any] {
        let normalized = text.replacingOccurrences(of: "\u{0000}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        let wasTruncated = truncated || normalized.count > maximumTextCharacters
        let limited = String(normalized.prefix(maximumTextCharacters))
        let incomplete = wasTruncated || partial
        var value: [String: Any] = ["status": limited.isEmpty ? "no_text" : incomplete ? "partial" : "read",
                                  "text": limited, "truncated": wasTruncated, "parser": parser,
                                  "characters": limited.count,
                                  "extractionCoverage": limited.isEmpty ? "none" : incomplete ? "partial" : "text_extracted",
                                  "textOnly": true, "semanticVerified": false,
                                  "error": limited.isEmpty ? "未提取到可确认的附件正文" : incomplete ? detail : ""]
        if !incomplete && !detail.isEmpty { value["note"] = detail }
        if incomplete && !limited.isEmpty && detail.isEmpty { value["error"] = wasTruncated ? "达到本机解析上限，已保存部分正文" : "部分内容尚未确认，请核对原件" }
        value.merge(metadata) { old, _ in old }
        return value
    }

    /// Internal synchronous entry point for deterministic local fixture tests.
    static func parseSynchronously(data: Data, mimeType: String, name: String) -> [String: Any] {
        guard !data.isEmpty else { return result("", parser: "empty") }
        guard data.count <= maximumFileBytes else { return failed(ParseError.tooLarge) }
        let mime = mimeType.lowercased().split(separator: ";").first.map(String.init) ?? ""
        let ext = URL(fileURLWithPath: name).pathExtension.lowercased()
        let signature = Array(data.prefix(8))
        // Reject executable formats even when mislabeled as plain text.
        if signature.starts(with: [0x4d, 0x5a]) || signature.starts(with: [0x7f, 0x45, 0x4c, 0x46]) ||
           signature.starts(with: [0xcf, 0xfa, 0xed, 0xfe]) || signature.starts(with: [0xfe, 0xed, 0xfa, 0xcf]) ||
           ["exe", "dll", "app", "dmg", "pkg", "command", "sh", "bat", "ps1", "js", "py"].contains(ext) {
            return ["status": "unsupported", "text": "", "truncated": false, "error": "可执行文件不进行正文解析"]
        }
        do {
            if data.prefix(1024).range(of: Data("%PDF-".utf8)) != nil {
                return try parsePDF(data)
            }
            if signature.starts(with: [0x50, 0x4b, 0x03, 0x04]) {
                guard ["docx", "xlsx"].contains(ext) || mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                        mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" else {
                    return ["status": "unsupported", "text": "", "truncated": false, "error": "仅解析 DOCX、XLSX 中的正文，普通压缩包未读取"]
                }
                return try parseOffice(data, spreadsheet: ext == "xlsx" || mime.contains("spreadsheetml"))
            }
            if let image = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(image) > 0 {
                return try parseImages(image)
            }
            if signature.starts(with: Array("{\\rtf".utf8)) { return parseRTF(data) }
            let textExtensions: Set<String> = ["txt", "csv", "tsv", "md", "markdown", "log", "html", "htm", "xml", "json"]
            if mime.hasPrefix("text/") || textExtensions.contains(ext) || ["application/json", "application/xml"].contains(mime) {
                let decoded = try decodeText(data)
                if ["html", "htm"].contains(ext) || mime == "text/html" {
                    return result(htmlText(decoded), parser: "html", truncated: decoded.count > 4_000_000)
                }
                return result(decoded, parser: ["csv", "tsv"].contains(ext) || mime == "text/csv" ? "table-text" : "text")
            }
            return ["status": "unsupported", "text": "", "truncated": false, "error": "此附件格式尚未支持本机正文解析"]
        } catch { return failed(error) }
    }

    private static func decodeText(_ data: Data) throws -> String {
        if data.starts(with: [0xff, 0xfe]) || data.starts(with: [0xfe, 0xff]), let text = String(data: data, encoding: .utf16) { return text }
        guard !data.prefix(8192).contains(0) else { throw ParseError.decoding }
        if let text = String(data: data, encoding: .utf8) { return text }
        let gb = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        if let text = String(data: data, encoding: gb) { return text }
        if let text = String(data: data, encoding: .windowsCP1252) { return text }
        throw ParseError.decoding
    }

    struct OCRLine {
        let text: String
        let confidence: Float
    }
    struct OCRResult {
        let lines: [OCRLine]
        var truncated = false
        var text: String { lines.map(\.text).joined(separator: "\n") }
        var lowConfidenceLines: Int { lines.filter { !$0.confidence.isFinite || $0.confidence < 0.65 }.count }
        var meanConfidence: Double {
            let values = lines.map { $0.confidence.isFinite ? Double(max(0, min(1, $0.confidence))) : 0 }
            return values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
        }
    }
    struct PDFLimits {
        var maximumPages = 100
        var maximumOCRPages = 12
        var timeBudget: TimeInterval = 35
    }
    typealias OCRReader = (CGImage, Date) throws -> OCRResult

    private static func recognize(_ image: CGImage, deadline: Date) throws -> OCRResult {
        guard Date() < deadline else { throw ParseError.extraction }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // The parser also runs from a command-line diagnostic without a Metal
        // device context. CPU execution keeps OCR available in that environment.
        request.usesCPUOnly = true
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        let cancel = DispatchWorkItem { request.cancel() }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + max(0.1, deadline.timeIntervalSinceNow), execute: cancel)
        defer { cancel.cancel() }
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let observations = request.results ?? []
        return OCRResult(lines: observations.prefix(10_000).compactMap {
            guard let candidate = $0.topCandidates(1).first else { return nil }
            return OCRLine(text: candidate.string, confidence: candidate.confidence)
        }, truncated: observations.count > 10_000)
    }

    private final class PDFVisualScan { var detected = false }
    private static func visualContent(_ page: PDFPage) -> String {
        // Inspect drawing operators rather than searching compressed PDF bytes.
        // A Form XObject may itself contain images or outlined text, so any Do
        // is conservatively visual. Quartz reports inline images through EI,
        // not BI/ID. Painted paths cover outlined letters; plain selectable
        // text needs no OCR.
        if page.annotations.contains(where: { $0.type != "Link" }) { return "detected" }
        guard let reference = page.pageRef, let table = CGPDFOperatorTableCreate() else { return "unknown" }
        let state = PDFVisualScan()
        let callback: CGPDFOperatorCallback = { scanner, info in
            guard let info = info else { return }
            Unmanaged<PDFVisualScan>.fromOpaque(info).takeUnretainedValue().detected = true
            CGPDFScannerStop(scanner)
        }
        for name in ["Do", "EI", "sh", "f", "F", "f*", "S", "s", "B", "B*", "b", "b*"] {
            CGPDFOperatorTableSetCallback(table, name, callback)
        }
        let stream = CGPDFContentStreamCreateWithPage(reference)
        let scanner = CGPDFScannerCreate(stream, table, Unmanaged.passUnretained(state).toOpaque())
        let scanned = CGPDFScannerScan(scanner)
        return state.detected ? "detected" : scanned ? "not_detected" : "unknown"
    }

    private static func normalizedLine(_ value: String) -> String {
        // Do not remove punctuation/digits or use fuzzy matching: near-equal
        // roster names, class numbers and times must remain distinct.
        value.folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .components(separatedBy: .whitespacesAndNewlines).joined()
    }
    private static func supplementalLines(_ recognized: OCRResult, nativeText: String) -> [String] {
        var remaining = [String: Int]()
        for line in nativeText.components(separatedBy: .newlines) {
            let key = normalizedLine(line)
            if !key.isEmpty { remaining[key, default: 0] += 1 }
        }
        return recognized.lines.compactMap { line in
            let text = line.text.trimmingCharacters(in: .whitespacesAndNewlines), key = normalizedLine(text)
            guard !key.isEmpty else { return nil }
            if let count = remaining[key], count > 0 { remaining[key] = count - 1; return nil }
            return text
        }
    }

    // Limits/recognizer injection keeps failure and budget fixtures deterministic
    // without changing production defaults or installing any global test hooks.
    static func parsePDF(_ data: Data, limits: PDFLimits = PDFLimits(), recognition: OCRReader? = nil) throws -> [String: Any] {
        guard let document = PDFDocument(data: data) else { throw ParseError.malformedPDF }
        guard !document.isLocked else { throw ParseError.encryptedPDF }
        let count = document.pageCount
        let pageLimit = max(0, min(100, limits.maximumPages)), ocrLimit = max(0, min(12, limits.maximumOCRPages))
        let deadline = Date().addingTimeInterval(max(0, min(35, limits.timeBudget)))
        let reader = recognition ?? recognize
        var text = "", read = 0, ocr = 0, truncated = count > pageLimit, partial = false
        var coverage = [[String: Any]](), warnings = [String]()
        func warn(_ message: String) { if warnings.count < 8 && !warnings.contains(message) { warnings.append(message) } }
        if count > pageLimit { warn("PDF 超过本轮页数上限，未检查的页面仍需核对原件") }
        for index in 0..<min(count, pageLimit) {
            var item: [String: Any] = ["page": index + 1, "status": "skipped", "method": "none", "visualContent": "unknown", "ocrStatus": "not_needed", "characters": 0]
            if text.count >= maximumTextCharacters || Date() >= deadline {
                truncated = true; item["reason"] = "达到文字或时间上限，此页尚未读取"; coverage.append(item); continue
            }
            guard let page = document.page(at: index) else {
                partial = true; item["reason"] = "此页无法打开"; coverage.append(item); continue
            }
            let pageText: String = autoreleasepool {
                let extracted = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let visual = visualContent(page)
                item["visualContent"] = visual
                item["method"] = extracted.isEmpty ? "none" : "pdf_text"
                item["status"] = extracted.isEmpty ? "no_text" : "text_extracted"
                guard extracted.isEmpty || visual != "not_detected" else { return extracted }
                func uncertain(_ status: String, _ reason: String) {
                    partial = true; item["status"] = "partial"; item["ocrStatus"] = status; item["reason"] = reason
                    warn("第 \(index + 1) 页：" + reason)
                }
                guard ocr < ocrLimit && Date() < deadline else {
                    truncated = true; uncertain("limit", "达到 OCR 页数或时间上限，图像内容尚未确认"); return extracted
                }
                let bounds = page.bounds(for: .mediaBox)
                guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0,
                      bounds.width < 100_000, bounds.height < 100_000 else {
                    uncertain("failed", "页面尺寸无效，图像内容尚未确认"); return extracted
                }
                ocr += 1
                item["method"] = extracted.isEmpty ? "ocr" : "pdf_text+ocr"
                let thumbnail = page.thumbnail(of: CGSize(width: 2000, height: 2600), for: .mediaBox)
                guard let image = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                    uncertain("failed", "页面图像无法生成，已保留可选文字"); return extracted
                }
                do {
                    let recognized = try reader(image, deadline)
                    let added = supplementalLines(recognized, nativeText: extracted)
                    item["ocrStatus"] = "completed"
                    item["ocrMeanConfidence"] = recognized.meanConfidence
                    item["ocrLowConfidenceLines"] = recognized.lowConfidenceLines
                    warn("OCR 仅提取文字，姓名、日期及表格对应关系尚未核验，请核对原件")
                    if recognized.truncated { truncated = true; uncertain("limit", "OCR 文字数量达到上限") }
                    else if recognized.lowConfidenceLines > 0 { uncertain("completed", "部分 OCR 文字置信度较低，请核对原件") }
                    else if added.isEmpty { uncertain("no_text", "未提取到额外可确认的图像文字，请核对原件") }
                    else if visual == "unknown" { uncertain("completed", "页面图像覆盖范围无法确认，请核对原件") }
                    else { item["status"] = "text_extracted" }
                    return ([extracted].filter { !$0.isEmpty } + added).joined(separator: "\n")
                } catch {
                    uncertain("failed", "OCR 未完成，已保留可选文字；图像内容尚未确认"); return extracted
                }
            }
            item["characters"] = min(maximumTextCharacters, pageText.count)
            if !pageText.isEmpty {
                read += 1
                let combined = (text.isEmpty ? "" : "\n\n") + "第 \(index + 1) 页\n" + pageText
                let available = max(0, maximumTextCharacters - text.count)
                if combined.count > available {
                    truncated = true; item["status"] = "partial"; item["reason"] = "达到文字上限，部分正文未保留"
                }
                text += String(combined.prefix(available))
            }
            coverage.append(item)
        }
        return result(text, parser: ocr > 0 ? "pdfkit+vision" : "pdfkit", truncated: truncated, partial: partial,
                      detail: partial || truncated ? "部分页面或图像文字尚未确认，请查看逐页状态并核对原件" : "",
                      metadata: ["pagesTotal": count, "pagesRead": read, "ocrPages": ocr, "pageCoverage": coverage, "warnings": warnings])
    }

    static func parseImages(_ source: CGImageSource, recognition: OCRReader? = nil) throws -> [String: Any] {
        let count = CGImageSourceGetCount(source)
        let deadline = Date().addingTimeInterval(35)
        let reader = recognition ?? recognize
        var text = "", read = 0, truncated = count > 10, partial = false, errors = [String]()
        var coverage = [[String: Any]](), warnings = [String]()
        func warn(_ message: String) { if warnings.count < 8 && !warnings.contains(message) { warnings.append(message) } }
        if count > 10 { warn("图片帧数超过本轮上限，未处理的内容仍需核对原件") }
        for index in 0..<min(count, 10) {
            var item: [String: Any] = ["page": index + 1, "status": "skipped", "method": "ocr", "visualContent": "detected", "ocrStatus": "not_needed", "characters": 0]
            if text.count >= maximumTextCharacters || Date() >= deadline {
                truncated = true; item["reason"] = "达到文字或时间上限，此图片尚未读取"; coverage.append(item); continue
            }
            let frame: OCRResult? = autoreleasepool {
                guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
                      let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
                      let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
                      width.doubleValue > 0, height.doubleValue > 0,
                      width.doubleValue * height.doubleValue <= 40_000_000 else {
                    truncated = true; item["ocrStatus"] = "limit"; item["reason"] = "图片尺寸无效或超过像素上限"; return nil
                }
                let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                              kCGImageSourceCreateThumbnailWithTransform: true,
                                              kCGImageSourceThumbnailMaxPixelSize: 2400,
                                              kCGImageSourceShouldCacheImmediately: true]
                guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary) else {
                    item["ocrStatus"] = "failed"; item["reason"] = "图片无法解码"; return nil
                }
                do { return try reader(image, deadline) }
                catch {
                    let failure = error as NSError
                    errors.append(failure.domain + ":" + String(failure.code))
                    item["ocrStatus"] = "failed"; item["reason"] = "OCR 未完成，请核对原件"; return nil
                }
            }
            guard let recognized = frame else {
                partial = true; item["status"] = "partial"; coverage.append(item)
                warn("第 \(index + 1) 幅图片：" + (item["reason"] as? String ?? "内容尚未确认")); continue
            }
            read += 1
            let content = recognized.text.trimmingCharacters(in: .whitespacesAndNewlines)
            item["ocrStatus"] = content.isEmpty ? "no_text" : "completed"
            item["status"] = content.isEmpty ? "no_text" : "text_extracted"
            item["ocrMeanConfidence"] = recognized.meanConfidence
            item["ocrLowConfidenceLines"] = recognized.lowConfidenceLines
            item["characters"] = min(maximumTextCharacters, content.count)
            warn("OCR 仅提取文字，姓名、日期及表格对应关系尚未核验，请核对原件")
            if content.isEmpty {
                partial = true; item["reason"] = "未提取到可确认的图像文字，请核对原件"
            } else if recognized.lowConfidenceLines > 0 {
                partial = true; item["status"] = "partial"; item["reason"] = "部分 OCR 文字置信度较低，请核对原件"
            }
            if recognized.truncated {
                truncated = true; item["status"] = "partial"; item["ocrStatus"] = "limit"; item["reason"] = "OCR 文字数量达到上限"
            }
            if !content.isEmpty {
                let combined = (text.isEmpty ? "" : "\n\n") + content, available = max(0, maximumTextCharacters - text.count)
                if combined.count > available {
                    truncated = true; item["status"] = "partial"; item["reason"] = "达到文字上限，部分正文未保留"
                }
                text += String(combined.prefix(available))
            }
            if let reason = item["reason"] as? String { warn("第 \(index + 1) 幅图片：" + reason) }
            coverage.append(item)
        }
        if read == 0 && !errors.isEmpty {
            var failure = failed(ParseError.extraction)
            failure["parser"] = "vision"; failure["truncated"] = truncated
            failure["extractionCoverage"] = "none"; failure["textOnly"] = true; failure["semanticVerified"] = false
            failure["pagesTotal"] = count; failure["pagesRead"] = 0
            failure["pageCoverage"] = coverage; failure["warnings"] = warnings
            failure["diagnostics"] = Array(errors.prefix(5)); return failure
        }
        return result(text, parser: "vision", truncated: truncated, partial: partial,
                      detail: partial || truncated ? "部分图像文字尚未确认，请查看逐页状态并核对原件" : "",
                      metadata: ["pagesTotal": count, "pagesRead": read, "ocrErrors": errors.count, "pageCoverage": coverage, "warnings": warnings])
    }

    private static func htmlText(_ html: String) -> String {
        // Operates on strings only. Never instantiates a web view or loads URLs.
        var text = String(html.prefix(4_000_000))
        for tag in ["script", "style", "noscript", "svg"] {
            text = text.replacingOccurrences(of: "(?is)<" + tag + "\\b[^>]*>.*?</" + tag + "\\s*>", with: "", options: .regularExpression)
        }
        text = text.replacingOccurrences(of: "(?s)<!--.*?-->", with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: "(?i)<(?:br|/p|/div|/tr|/li|/h[1-6])\\b[^>]*>", with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: "(?i)</t[dh]\\s*>", with: "\t", options: .regularExpression)
        text = text.replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
        let entity = try! NSRegularExpression(pattern: "&#(x[0-9a-fA-F]{1,6}|[0-9]{1,7});", options: [])
        for match in entity.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let range = Range(match.range(at: 1), in: text), let whole = Range(match.range, in: text) else { continue }
            let raw = String(text[range])
            let value = raw.hasPrefix("x") ? UInt32(raw.dropFirst(), radix: 16) : UInt32(raw)
            if let value = value, let scalar = UnicodeScalar(value) { text.replaceSubrange(whole, with: String(scalar)) }
        }
        for (encoded, decoded) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&amp;", "&")] {
            text = text.replacingOccurrences(of: encoded, with: decoded)
        }
        return text.replacingOccurrences(of: "[ \\t]+\\n", with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
    }

    private struct RTFState { var skip = false; var unicodeFallback = 1; var codePage: UInt32 = 1252 }
    private static func parseRTF(_ data: Data) -> [String: Any] {
        let bytes = Array(data), limit = maximumTextCharacters + 1
        var index = 0, states = [RTFState()], units = [UInt16](), skipFallback = 0, raw = Data(), partial = false
        let excluded: Set<String> = ["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "objdata", "fldinst", "filetbl", "datastore", "themedata", "xmlnstbl"]
        func flush() {
            guard !raw.isEmpty else { return }
            let encoding = CFStringConvertWindowsCodepageToEncoding(states.last?.codePage ?? 1252)
            if let value = String(data: raw, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(encoding))) {
                units.append(contentsOf: value.utf16)
            } else { partial = true }
            raw.removeAll(keepingCapacity: true)
        }
        func appendByte(_ value: UInt8) {
            if skipFallback > 0 { skipFallback -= 1; return }
            if states.last?.skip == false { raw.append(value) }
            if raw.count > 4096 { flush() }
        }
        func append(_ value: UInt16) {
            flush()
            if states.last?.skip == false { units.append(value) }
        }
        while index < bytes.count && units.count <= limit {
            let byte = bytes[index]; index += 1
            if byte == 123 {
                flush()
                if states.count >= 100 { return result(String(decoding: units, as: UTF16.self), parser: "rtf", truncated: true) }
                states.append(states.last!); continue
            }
            if byte == 125 { flush(); if states.count > 1 { states.removeLast() }; continue }
            if byte == 10 || byte == 13 { continue }
            if byte != 92 { appendByte(byte); continue }
            guard index < bytes.count else { break }
            let next = bytes[index]; index += 1
            if [92, 123, 125].contains(next) { appendByte(next); continue }
            if next == 42 { flush(); states[states.count - 1].skip = true; continue }
            if next == 39, index + 2 <= bytes.count {
                let hex = String(bytes: bytes[index..<index + 2], encoding: .ascii) ?? ""
                if let value = UInt8(hex, radix: 16) { appendByte(value) }
                index += 2; continue
            }
            if next == 126 { append(160); continue }
            guard (65...90).contains(next) || (97...122).contains(next) else { continue }
            var word = String(UnicodeScalar(next))
            while index < bytes.count && ((65...90).contains(bytes[index]) || (97...122).contains(bytes[index])) {
                if word.count < 50 { word.append(Character(UnicodeScalar(bytes[index]))) }
                index += 1
            }
            var numberText = ""
            if index < bytes.count && bytes[index] == 45 { numberText = "-"; index += 1 }
            while index < bytes.count && (48...57).contains(bytes[index]) {
                if numberText.count < 12 { numberText.append(Character(UnicodeScalar(bytes[index]))) }; index += 1
            }
            let number = Int(numberText)
            if index < bytes.count && bytes[index] == 32 { index += 1 }
            flush()
            if excluded.contains(word) {
                if ["pict", "object", "objdata"].contains(word) { partial = true }
                states[states.count - 1].skip = true
            }
            else if word == "bin", let length = number, length >= 0 { index = min(bytes.count, index + min(length, bytes.count)) }
            else if word == "uc", let value = number { states[states.count - 1].unicodeFallback = max(0, min(value, 16)) }
            else if word == "ansicpg", let value = number, value > 0, value < 100_000 { states[states.count - 1].codePage = UInt32(value) }
            else if word == "u", let value = number {
                if states.last?.skip == false { units.append(UInt16(truncatingIfNeeded: value)) }
                skipFallback = states.last?.unicodeFallback ?? 1
            } else if word == "par" || word == "line" { append(10) }
            else if word == "tab" { append(9) }
            else if let value: UInt16 = ["emdash": 0x2014, "endash": 0x2013, "bullet": 0x2022, "lquote": 0x2018, "rquote": 0x2019, "ldblquote": 0x201c, "rdblquote": 0x201d][word] { append(value) }
        }
        flush()
        return result(String(decoding: units, as: UTF16.self), parser: "rtf", truncated: partial || index < bytes.count || states.count != 1)
    }

    private struct ZipEntry { let name: String; let compressed: Int; let expanded: Int; let offset: Int; let method: Int }
    private static func zipIndex(_ data: Data) throws -> [String: ZipEntry] {
        func u16(_ at: Int) -> Int { Int(data[at]) | Int(data[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        guard data.count >= 22 else { throw ParseError.invalidArchive }
        var end: Int?
        for at in stride(from: data.count - 22, through: max(0, data.count - 65_557), by: -1) {
            if u32(at) == 0x06054b50 && at + 22 + u16(at + 20) == data.count { end = at; break }
        }
        guard let end = end, u16(end + 4) == 0, u16(end + 6) == 0,
              u16(end + 8) == u16(end + 10), u16(end + 10) <= 4096 else { throw ParseError.invalidArchive }
        let count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16)
        guard centralSize <= 4_194_304, centralStart <= end, centralSize <= end - centralStart else { throw ParseError.archiveLimit }
        var at = centralStart, entries = [String: ZipEntry]()
        for _ in 0..<count {
            guard at + 46 <= centralStart + centralSize, u32(at) == 0x02014b50 else { throw ParseError.invalidArchive }
            let flags = u16(at + 8), method = u16(at + 10), compressed = u32(at + 20), expanded = u32(at + 24)
            let nameSize = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), offset = u32(at + 42)
            let entryEnd = at + 46 + nameSize + extra + comment
            guard entryEnd <= centralStart + centralSize, u16(at + 34) == 0, flags & 1 == 0,
                  let name = String(data: data[(at + 46)..<(at + 46 + nameSize)], encoding: .utf8),
                  !name.isEmpty, !name.hasPrefix("/"), !name.contains("\\"), !name.contains("\0"), !name.contains(":"),
                  !name.split(separator: "/", omittingEmptySubsequences: false).contains(".."), entries[name] == nil,
                  (u32(at + 38) >> 16) & 0xf000 != 0xa000,
                  offset >= 0, offset + 30 <= centralStart, u32(offset) == 0x04034b50 else { throw ParseError.invalidArchive }
            let localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28)
            let payload = offset + 30 + localNameLength + localExtraLength
            guard payload <= centralStart, compressed <= centralStart - payload,
                  u16(offset + 8) == method, u16(offset + 6) & 1 == 0,
                  String(data: data[(offset + 30)..<(offset + 30 + localNameLength)], encoding: .utf8) == name else { throw ParseError.invalidArchive }
            entries[name] = ZipEntry(name: name, compressed: compressed, expanded: expanded, offset: offset, method: method)
            at = entryEnd
        }
        guard at == centralStart + centralSize else { throw ParseError.invalidArchive }
        return entries
    }

    private static func readEntry(_ entry: ZipEntry, archive: URL) throws -> Data {
        guard [0, 8].contains(entry.method), entry.expanded <= 16_777_216,
              entry.expanded <= max(1_048_576, entry.compressed * 250) else { throw ParseError.archiveLimit }
        let process = Process(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        // Exactly one validated XML entry; no wildcard, directory extraction, or shell.
        process.arguments = ["-p", archive.path, entry.name]
        process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run()
        let cancel = DispatchWorkItem {
            if process.isRunning { process.terminate() }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1) {
                if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
            }
        }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5, execute: cancel)
        defer {
            if process.isRunning { process.terminate() }
            cancel.cancel(); try? output.fileHandleForReading.close()
        }
        var result = Data(), overLimit = false
        while let part = try output.fileHandleForReading.read(upToCount: 65_536), !part.isEmpty {
            if result.count + part.count > min(16_777_216, entry.expanded) {
                overLimit = true; if process.isRunning { process.terminate() }; break
            }
            result.append(part)
        }
        process.waitUntilExit()
        guard !overLimit, process.terminationStatus == 0, result.count == entry.expanded else { throw ParseError.invalidArchive }
        return result
    }

    private final class XMLText: NSObject, XMLParserDelegate {
        enum Kind { case word, strings, sheet, workbook, relationships }
        let kind: Kind
        let shared: [String]
        var text = "", strings = [String](), names = [String](), truncated = false
        var namedSheets = [(id: String, name: String)](), relationships = [String: String]()
        private var current = "", value = "", cellType = "", column = "", depth = 0, elements = 0, textDepth = 0
        private var budget = 0, formula = false
        private let deadline = Date().addingTimeInterval(15)
        init(_ kind: Kind, shared: [String] = []) { self.kind = kind; self.shared = shared }
        func append(_ value: String) {
            let remaining = max(0, maximumTextCharacters + 1 - text.count)
            if value.count > remaining { truncated = true }
            text += String(value.prefix(remaining))
        }
        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes: [String: String]) {
            depth += 1; elements += 1
            if depth > 100 || elements > 250_000 || elements % 256 == 0 && Date() >= deadline { truncated = true; parser.abortParsing(); return }
            let tag = elementName.split(separator: ":").last.map(String.init) ?? elementName
            if kind == .word {
                if tag == "t" { textDepth = depth }
                else if tag == "tab" { append("\t") }
                else if tag == "br" || tag == "cr" { append("\n") }
            } else if kind == .strings {
                if tag == "si" { current = "" }
                if tag == "t" { textDepth = depth }
            } else if kind == .sheet {
                if tag == "c" { cellType = attributes["t"] ?? ""; column = attributes["r"] ?? ""; value = ""; formula = false }
                if tag == "f" { formula = true }
                if tag == "v" || tag == "t" { textDepth = depth }
            } else if kind == .workbook, tag == "sheet", let name = attributes["name"], names.count < 200 {
                names.append(String(name.prefix(200)))
                namedSheets.append((id: attributes["r:id"] ?? "", name: String(name.prefix(200))))
            } else if kind == .relationships, tag == "Relationship", let id = attributes["Id"], let target = attributes["Target"], relationships.count < 4096 {
                if attributes["TargetMode"] != "External" { relationships[id] = target }
            }
        }
        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard textDepth > 0 else { return }
            budget += string.utf8.count
            if budget > 16_777_216 { truncated = true; parser.abortParsing(); return }
            if kind == .word { append(string) }
            else if kind == .strings { if current.count < maximumTextCharacters { current += String(string.prefix(maximumTextCharacters - current.count)) } else { truncated = true } }
            else if kind == .sheet { if value.count < maximumTextCharacters { value += String(string.prefix(maximumTextCharacters - value.count)) } else { truncated = true } }
        }
        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            let tag = elementName.split(separator: ":").last.map(String.init) ?? elementName
            if depth == textDepth { textDepth = 0 }
            if kind == .word {
                if tag == "p" { append("\n") }
                else if tag == "tc" { append("\t") }
            } else if kind == .strings, tag == "si" {
                if strings.count >= 50_000 { truncated = true; parser.abortParsing() } else { strings.append(current) }
            } else if kind == .sheet {
                if tag == "c" {
                    let reference = Int(value).flatMap { shared.indices.contains($0) ? shared[$0] : nil }
                    if cellType == "s" && reference == nil || formula && value.isEmpty { truncated = true }
                    let cell = cellType == "s" ? (reference ?? "[共享文字缺失]") : value
                    if !cell.isEmpty { append((column.isEmpty ? "" : column + ": ") + cell + "\t") }
                } else if tag == "row" { append("\n") }
            }
            depth -= 1
            if text.count > maximumTextCharacters { truncated = true; parser.abortParsing() }
        }
    }
    private static func xml(_ data: Data, kind: XMLText.Kind, shared: [String] = []) throws -> XMLText {
        guard let content = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16),
              !content.contains("\u{0000}"),
              content.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil,
              content.range(of: "<!ENTITY", options: .caseInsensitive) == nil else { throw ParseError.invalidXML }
        let delegate = XMLText(kind, shared: shared), parser = XMLParser(data: data)
        parser.delegate = delegate; parser.shouldResolveExternalEntities = false; parser.externalEntityResolvingPolicy = .never
        guard parser.parse() || delegate.truncated else { throw ParseError.invalidXML }
        return delegate
    }
    private static func parseOffice(_ data: Data, spreadsheet: Bool) throws -> [String: Any] {
        let entries = try zipIndex(data)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-attachment-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: temporary) }
        let archive = temporary.appendingPathComponent("document.zip")
        try data.write(to: archive, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: archive.path)
        if !spreadsheet {
            guard let entry = entries["word/document.xml"] else { throw ParseError.invalidArchive }
            let parsed = try xml(readEntry(entry, archive: archive), kind: .word)
            let extras = entries.keys.contains { $0.hasPrefix("word/header") || $0.hasPrefix("word/footer") || $0 == "word/footnotes.xml" || $0 == "word/endnotes.xml" || $0.hasPrefix("word/media/") || $0.hasPrefix("word/embeddings/") || $0.hasPrefix("word/charts/") || $0.hasPrefix("word/comments") }
            return result(parsed.text, parser: "docx", truncated: parsed.truncated || extras,
                          detail: extras ? "已读取 Word 正文；页眉、页脚、脚注及嵌入图片尚未读取" : "")
        }
        let sheets = entries.values.filter { $0.name.range(of: "^xl/worksheets/sheet[0-9]+\\.xml$", options: .regularExpression) != nil }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        guard !sheets.isEmpty else { throw ParseError.invalidArchive }
        var shared = [String](), sheetNames = [String: String](), truncated = sheets.count > 30
        var expanded = 0
        if let strings = entries["xl/sharedStrings.xml"] {
            expanded += strings.expanded
            let parsed = try xml(readEntry(strings, archive: archive), kind: .strings)
            shared = parsed.strings; truncated = truncated || parsed.truncated
        }
        if let workbook = entries["xl/workbook.xml"], let relations = entries["xl/_rels/workbook.xml.rels"] {
            let workbookXML = try xml(readEntry(workbook, archive: archive), kind: .workbook)
            let relationshipXML = try xml(readEntry(relations, archive: archive), kind: .relationships)
            truncated = truncated || workbookXML.truncated || relationshipXML.truncated
            for sheet in workbookXML.namedSheets {
                guard let target = relationshipXML.relationships[sheet.id] else { truncated = true; continue }
                let normalized = target.hasPrefix("/xl/") ? String(target.dropFirst()) : "xl/" + target
                if entries[normalized] != nil { sheetNames[normalized] = sheet.name }
                else { truncated = true }
            }
        }
        var text = "", read = 0
        let deadline = Date().addingTimeInterval(25)
        for sheet in sheets.prefix(30) {
            if text.count >= maximumTextCharacters || Date() >= deadline { truncated = true; break }
            expanded += sheet.expanded
            if expanded > 33_554_432 { truncated = true; break }
            let parsed = try xml(readEntry(sheet, archive: archive), kind: .sheet, shared: shared)
            truncated = truncated || parsed.truncated
            if !parsed.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                text += (text.isEmpty ? "" : "\n\n") + (sheetNames[sheet.name] ?? sheet.name) + "\n" + parsed.text
            }
            read += 1
        }
        let extras = entries.keys.contains { $0.hasPrefix("xl/media/") || $0.hasPrefix("xl/charts/") || $0.hasPrefix("xl/comments") }
        return result(text, parser: "xlsx", truncated: truncated || extras,
                      detail: extras ? "已读取表格单元格缓存值；图片、图表与批注尚未读取" : "读取文件保存时的单元格值，未重新计算公式",
                      metadata: ["sheetsTotal": sheets.count, "sheetsRead": read])
    }
}
