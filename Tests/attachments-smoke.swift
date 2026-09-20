import Foundation
import CoreGraphics
import CoreText
import ImageIO
import PDFKit

// Standalone native fixtures, no user files and no network. Build together with
// Sources/TeamsAttachments.swift, not with the application's main.swift.
@main
struct AttachmentSmokeTests {
    static var passed = 0
    static func require(_ condition: @autoclosure () -> Bool, _ label: String) {
        guard condition() else { fputs("FAIL: \(label)\n", stderr); exit(1) }
        passed += 1
    }
    static func parse(_ text: String, name: String, mime: String = "application/octet-stream") -> [String: Any] {
        TeamsAttachmentParser.parseSynchronously(data: Data(text.utf8), mimeType: mime, name: name)
    }
    static func text(_ result: [String: Any]) -> String { result["text"] as? String ?? "" }
    static func status(_ result: [String: Any]) -> String { result["status"] as? String ?? "" }
    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xffffffff
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = crc & 1 == 1 ? (crc >> 1) ^ 0xedb88320 : crc >> 1 }
        }
        return crc ^ 0xffffffff
    }
    struct Entry {
        let name: String
        let body: String
        var expanded: Int? = nil
        var attributes: UInt32 = 0
        var bytes: Data? = nil
    }
    static func zip(_ entries: [Entry]) -> Data {
        var output = Data(), central = Data()
        func u16(_ value: Int, _ target: inout Data) { target.append(UInt8(truncatingIfNeeded: value)); target.append(UInt8(truncatingIfNeeded: value >> 8)) }
        func u32(_ value: Int, _ target: inout Data) { u16(value, &target); u16(value >> 16, &target) }
        for entry in entries {
            let name = Data(entry.name.utf8), content = entry.bytes ?? Data(entry.body.utf8), offset = output.count
            let checksum = Int(crc32(content)), expanded = entry.expanded ?? content.count
            u32(0x04034b50, &output); u16(20, &output); u16(0x800, &output); u16(0, &output)
            u16(0, &output); u16(0, &output); u32(checksum, &output); u32(content.count, &output); u32(expanded, &output)
            u16(name.count, &output); u16(0, &output); output.append(name); output.append(content)
            u32(0x02014b50, &central); u16(0x0314, &central); u16(20, &central); u16(0x800, &central); u16(0, &central)
            u16(0, &central); u16(0, &central); u32(checksum, &central); u32(content.count, &central); u32(expanded, &central)
            u16(name.count, &central); u16(0, &central); u16(0, &central); u16(0, &central); u16(0, &central)
            u32(Int(entry.attributes), &central); u32(offset, &central); central.append(name)
        }
        let offset = output.count
        output.append(central)
        u32(0x06054b50, &output); u16(0, &output); u16(0, &output); u16(entries.count, &output); u16(entries.count, &output)
        u32(central.count, &output); u32(offset, &output); u16(0, &output)
        return output
    }
    static func drawText(_ value: String, context: CGContext, size: CGFloat, y: CGFloat) {
        let attrs: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, size, nil),
                                                   NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)]
        context.textPosition = CGPoint(x: 35, y: y)
        CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: attrs)), context)
    }
    static func pdf(_ content: String, bitmap: CGImage? = nil, pages: Int = 1) -> Data {
        let storage = NSMutableData()
        var bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let consumer = CGDataConsumer(data: storage as CFMutableData)!
        let context = CGContext(consumer: consumer, mediaBox: &bounds, nil)!
        for _ in 0..<pages {
            context.beginPDFPage(nil)
            drawText(content, context: context, size: 24, y: 710)
            if let bitmap = bitmap { context.draw(bitmap, in: CGRect(x: 35, y: 380, width: 540, height: 144)) }
            context.endPDFPage()
        }
        context.closePDF()
        return storage as Data
    }
    static func bitmap(_ label: String = "CAMPUSDESK 2026 TEST") -> CGImage {
        let context = CGContext(data: nil, width: 1500, height: 400, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 1500, height: 400))
        drawText(label, context: context, size: 75, y: 180)
        return context.makeImage()!
    }
    static func image() -> Data {
        let storage = NSMutableData()
        let writer = CGImageDestinationCreateWithData(storage as CFMutableData, "public.png" as CFString, 1, nil)!
        CGImageDestinationAddImage(writer, bitmap(), nil); require(CGImageDestinationFinalize(writer), "image fixture generated")
        return storage as Data
    }
    static func inlineImagePDF() -> Data {
        // Inline images have no XObject resource dictionary. This fixture would
        // be missed by an image-resource-only mixed-page detector.
        let stream = "BT /F1 24 Tf 35 710 Td (INLINE HEADING) Tj ET\nq 200 0 0 100 35 400 cm\nBI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI\nQ\n"
        let objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                       "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
                       "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Length \(stream.utf8.count) >>\nstream\n" + stream + "endstream"]
        var output = "%PDF-1.4\n", offsets = [0]
        for (index, object) in objects.enumerated() {
            offsets.append(output.utf8.count); output += "\(index + 1) 0 obj\n" + object + "\nendobj\n"
        }
        let xref = output.utf8.count
        output += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
        for offset in offsets.dropFirst() { output += String(format: "%010d 00000 n \n", offset) }
        output += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
        return Data(output.utf8)
    }
    static func pages(_ result: [String: Any]) -> [[String: Any]] { result["pageCoverage"] as? [[String: Any]] ?? [] }
    static func mixedPDFFixtures() throws {
        let mixed = pdf("EC ROSTER TITLE", bitmap: bitmap("ALICE MONDAY 2026"))
        var calls = 0
        let recognized: TeamsAttachmentParser.OCRReader = { _, _ in
            calls += 1
            return .init(lines: [.init(text: "EC ROSTER TITLE", confidence: 0.99), .init(text: "ALICE MONDAY 2026", confidence: 0.98)])
        }
        let success = try TeamsAttachmentParser.parsePDF(mixed, recognition: recognized)
        require(calls == 1 && text(success).contains("ALICE MONDAY 2026"), "Mixed PDF supplements bitmap text despite a selectable heading")
        require(text(success).components(separatedBy: "EC ROSTER TITLE").count == 2, "Exact heading deduplicated once")
        require(status(success) == "read" && success["semanticVerified"] as? Bool == false && success["textOnly"] as? Bool == true, "Text extraction never claims roster/table semantic verification")
        require(pages(success).first?["page"] as? Int == 1 && (pages(success).first?["ocrMeanConfidence"] as? Double ?? 0) > 0.9, "Page provenance and OCR confidence retained")
        require(pages(success).first?["visualContent"] as? String == "detected" && success["extractionCoverage"] as? String == "text_extracted", "Mixed-page coverage metadata")
        let failed = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in throw NSError(domain: "FixtureOCR", code: 1) })
        require(status(failed) == "partial" && text(failed).contains("EC ROSTER TITLE") && failed["truncated"] as? Bool == false, "OCR failure preserves heading but is partial, not falsely truncated/read")
        require(pages(failed).first?["ocrStatus"] as? String == "failed", "OCR failure has per-page reason")
        let empty = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in .init(lines: []) })
        require(status(empty) == "partial" && pages(empty).first?["ocrStatus"] as? String == "no_text", "Empty OCR cannot certify the mixed page")
        let onlyHeading = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in .init(lines: [.init(text: "EC ROSTER TITLE", confidence: 1)]) })
        require(status(onlyHeading) == "partial", "OCR repeating only the heading cannot certify image coverage")
        let uncertain = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in .init(lines: [.init(text: "ALICE MONDAY 2026", confidence: 0.2)]) })
        require(status(uncertain) == "partial" && pages(uncertain).first?["ocrLowConfidenceLines"] as? Int == 1, "Low-confidence roster text remains partial")
        let limited = try TeamsAttachmentParser.parsePDF(pdf("EC ROSTER TITLE", bitmap: bitmap(), pages: 2), limits: .init(maximumPages: 100, maximumOCRPages: 1, timeBudget: 35), recognition: recognized)
        require(status(limited) == "partial" && limited["truncated"] as? Bool == true && pages(limited).last?["ocrStatus"] as? String == "limit", "OCR page cap preserves native text and marks missing visual coverage")
        require(text(limited).contains("第 2 页"), "Limited mixed page retains its selectable text and page marker")
        let timed = try TeamsAttachmentParser.parsePDF(mixed, limits: .init(maximumPages: 100, maximumOCRPages: 12, timeBudget: 0), recognition: recognized)
        require(status(timed) == "no_text" && timed["truncated"] as? Bool == true && pages(timed).first?["status"] as? String == "skipped", "Expired time budget is never read")
        let countLimited = try TeamsAttachmentParser.parsePDF(pdf("FIRST PAGE", pages: 2), limits: .init(maximumPages: 1, maximumOCRPages: 12, timeBudget: 35), recognition: recognized)
        require(status(countLimited) == "partial" && countLimited["pagesTotal"] as? Int == 2 && pages(countLimited).count == 1, "PDF page cap explicitly incomplete")
        let nativeOnly = try TeamsAttachmentParser.parsePDF(pdf("ONLY SELECTABLE TEXT"), recognition: { _, _ in fatalError("Pure text must not use OCR") })
        require(status(nativeOnly) == "read" && nativeOnly["ocrPages"] as? Int == 0, "Plain text PDF does not consume the OCR budget")
        let inline = try TeamsAttachmentParser.parsePDF(inlineImagePDF(), recognition: { _, _ in .init(lines: [.init(text: "INLINE IMAGE TEXT", confidence: 0.99)]) })
        require(text(inline).contains("INLINE IMAGE TEXT") && inline["ocrPages"] as? Int == 1, "Inline image plus native text also triggers OCR: \(inline)")
        let distinct = try TeamsAttachmentParser.parsePDF(pdf("CLASS 1", bitmap: bitmap()), recognition: { _, _ in
            .init(lines: [.init(text: "CLASS 1", confidence: 1), .init(text: "CLASS 10", confidence: 1), .init(text: "CLASS 1", confidence: 1)])
        })
        require(text(distinct).contains("CLASS 10") && text(distinct).components(separatedBy: .newlines).filter { $0 == "CLASS 1" }.count == 2, "No fuzzy dedup or global removal of repeated raster text")
        let observationLimit = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in .init(lines: [.init(text: "ALICE", confidence: 1)], truncated: true) })
        require(status(observationLimit) == "partial" && observationLimit["truncated"] as? Bool == true, "OCR observation cap does not claim full text coverage")
        let textLimit = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in .init(lines: [.init(text: String(repeating: "A", count: 90_000), confidence: 1)]) })
        require(status(textLimit) == "partial" && text(textLimit).count == 80_000 && pages(textLimit).first?["status"] as? String == "partial", "Mixed-PDF output cap preserves accurate partial page state")
        let invalidConfidence = try TeamsAttachmentParser.parsePDF(mixed, recognition: { _, _ in .init(lines: [.init(text: "ALICE", confidence: .nan)]) })
        require(status(invalidConfidence) == "partial" && JSONSerialization.isValidJSONObject(invalidConfidence), "Unknown OCR confidence is partial and remains valid JSON")
        require(JSONSerialization.isValidJSONObject(success) && JSONSerialization.isValidJSONObject(failed), "PDF coverage remains plain JSON")
    }
    static func imageCoverageFixtures() throws {
        let source = CGImageSourceCreateWithData(image() as CFData, nil)!
        let clear = try TeamsAttachmentParser.parseImages(source, recognition: { _, _ in .init(lines: [.init(text: "ALICE", confidence: 0.99)]) })
        require(status(clear) == "read" && clear["semanticVerified"] as? Bool == false && !(clear["warnings"] as? [String] ?? []).isEmpty, "Image OCR retains semantic warning even for clear text")
        let low = try TeamsAttachmentParser.parseImages(source, recognition: { _, _ in .init(lines: [.init(text: "ALICE", confidence: 0.1)]) })
        require(status(low) == "partial" && low["truncated"] as? Bool == false && pages(low).first?["ocrLowConfidenceLines"] as? Int == 1, "Low-confidence image text is partial, not fully read or truncated")
        let capped = try TeamsAttachmentParser.parseImages(source, recognition: { _, _ in .init(lines: [.init(text: "ALICE", confidence: 1)], truncated: true) })
        require(status(capped) == "partial" && capped["truncated"] as? Bool == true && pages(capped).first?["ocrStatus"] as? String == "limit", "Image OCR observation cap is retained")
        let failed = try TeamsAttachmentParser.parseImages(source, recognition: { _, _ in throw NSError(domain: "FixtureOCR", code: 1) })
        require(status(failed) == "error" && failed["extractionCoverage"] as? String == "none" && pages(failed).first?["ocrStatus"] as? String == "failed", "Image OCR failure has truthful coverage")
        let empty = try TeamsAttachmentParser.parseImages(source, recognition: { _, _ in .init(lines: []) })
        require(status(empty) == "no_text" && empty["extractionCoverage"] as? String == "none", "Empty image OCR is never read")
        let long = try TeamsAttachmentParser.parseImages(source, recognition: { _, _ in .init(lines: [.init(text: String(repeating: "A", count: 90_000), confidence: 1)]) })
        require(status(long) == "partial" && text(long).count == 80_000 && pages(long).first?["status"] as? String == "partial", "Image output limit agrees with page coverage")
        require(JSONSerialization.isValidJSONObject(low) && JSONSerialization.isValidJSONObject(failed), "Image confidence and failures remain valid JSON")
    }
    static func main() throws {
        let plain = parse("老师反馈：完成得很好。", name: "feedback.txt")
        require(status(plain) == "read" && text(plain).contains("完成得很好"), "UTF-8 Chinese plain text")
        require(status(parse("name,score\nAlice,95", name: "scores.csv")) == "read", "CSV")
        let utf16 = TeamsAttachmentParser.parseSynchronously(data: "Roster 名单".data(using: .utf16)!, mimeType: "text/plain", name: "roster.txt")
        require(text(utf16).contains("名单"), "UTF-16 BOM")
        let html = parse("<html><style>SECRETSTYLE</style><script>SECRETJS</script><p>Feedback &amp; &#x4E2D;&#25991;</p></html>", name: "feedback.html")
        require(status(html) == "read" && text(html).contains("Feedback & 中文") && !text(html).contains("SECRET"), "HTML entities and no script/style text")
        let rtf = parse("{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 FontMetadata;}}Teacher\\par \\u20013?\\u25991?}", name: "feedback.rtf")
        require(status(rtf) == "read" && text(rtf).contains("中文") && !text(rtf).contains("FontMetadata"), "RTF unicode and destinations")
        let gbRTF = parse("{\\rtf1\\ansi\\ansicpg936\\'d6\\'d0\\'ce\\'c4}", name: "roster.rtf")
        require(text(gbRTF) == "中文", "RTF GBK ANSI bytes")
        require(status(parse("{\\rtf1正文{\\pict 001122}}", name: "image.rtf")) == "partial", "RTF embedded image not marked fully read")
        let large = parse(String(repeating: "x", count: 90_000), name: "long.txt")
        require(status(large) == "partial" && text(large).count == 80_000 && large["truncated"] as? Bool == true, "80k text bound")
        require(status(parse("MZ executable", name: "renamed.txt")) == "unsupported", "Executable signature rejected")
        let oversized = TeamsAttachmentParser.parseSynchronously(data: Data(repeating: 65, count: TeamsAttachmentParser.maximumFileBytes + 1), mimeType: "text/plain", name: "big.txt")
        require(status(oversized) == "error" && text(oversized).isEmpty, "25MiB input bound")
        let pdfData = pdf("CampusDesk local PDF text 2026")
        let pdfResult = TeamsAttachmentParser.parseSynchronously(data: pdfData, mimeType: "application/pdf", name: "feedback.pdf")
        require(status(pdfResult) == "read" && text(pdfResult).contains("CampusDesk local PDF text"), "PDFKit real PDF text extraction")
        let encrypted = PDFDocument(data: pdfData)!.dataRepresentation(options: [PDFDocumentWriteOption.userPasswordOption: "fixture-password", PDFDocumentWriteOption.ownerPasswordOption: "fixture-owner"])!
        let protected = TeamsAttachmentParser.parseSynchronously(data: encrypted, mimeType: "application/pdf", name: "encrypted.pdf")
        require(status(protected) == "error" && text(protected).isEmpty, "Locked PDF not marked read")
        try mixedPDFFixtures()
        try imageCoverageFixtures()
        if CommandLine.arguments.contains("--skip-vision") {
            print("SKIP: Vision bitmap OCR explicitly omitted for sandbox-only fixture run")
        } else {
            let ocr = TeamsAttachmentParser.parseSynchronously(data: image(), mimeType: "image/png", name: "roster.png")
            require(["read", "partial"].contains(status(ocr)) && text(ocr).uppercased().contains("CAMPUSDESK") && ocr["semanticVerified"] as? Bool == false, "Vision OCR actual bitmap: \(ocr)")
            let imageLowConfidence = pages(ocr).contains { ($0["ocrLowConfidenceLines"] as? Int ?? 0) > 0 }
            require(!pages(ocr).isEmpty && (!imageLowConfidence || status(ocr) == "partial"), "Actual bitmap OCR preserves partial status for low-confidence text")
            let mixedOCR = TeamsAttachmentParser.parseSynchronously(data: pdf("EC ROSTER TITLE", bitmap: bitmap("ALICE MONDAY 2026")), mimeType: "application/pdf", name: "mixed-roster.pdf")
            require(["read", "partial"].contains(status(mixedOCR)) && text(mixedOCR).uppercased().contains("ALICE") && text(mixedOCR).contains("EC ROSTER TITLE") && mixedOCR["semanticVerified"] as? Bool == false, "Actual Vision extracts raster roster alongside native PDF heading: \(mixedOCR)")
            let mixedLowConfidence = pages(mixedOCR).contains { ($0["ocrLowConfidenceLines"] as? Int ?? 0) > 0 }
            require(!pages(mixedOCR).isEmpty && (!mixedLowConfidence || status(mixedOCR) == "partial"), "Actual mixed-page OCR preserves partial status for low-confidence text")
            require(text(mixedOCR).components(separatedBy: "EC ROSTER TITLE").count == 2 && mixedOCR["ocrPages"] as? Int == 1, "Actual mixed-page OCR exact heading dedup and coverage")
        }

        let word = "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>老师反馈 &amp; EC 名单</w:t></w:r></w:p></w:body></w:document>"
        let docx = zip([Entry(name: "word/document.xml", body: word)])
        let wordResult = TeamsAttachmentParser.parseSynchronously(data: docx, mimeType: "application/octet-stream", name: "feedback.docx")
        require(status(wordResult) == "read" && text(wordResult).contains("老师反馈 & EC 名单"), "DOCX bounded entry/XML extraction")
        let wordWithImages = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: word), Entry(name: "word/media/image1.png", body: "not-opened")]), mimeType: "", name: "image.docx")
        require(status(wordWithImages) == "partial", "Unparsed DOCX image coverage retained")
        let workbook = "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Math\" r:id=\"r2\"/><sheet name=\"EC Roster\" r:id=\"r1\"/></sheets></workbook>"
        let relationships = "<Relationships><Relationship Id=\"r1\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"r2\" Target=\"worksheets/sheet2.xml\"/></Relationships>"
        let sheet1 = "<worksheet><sheetData><row><c r=\"A1\" t=\"s\"><v>0</v></c></row></sheetData></worksheet>"
        let sheet2 = "<worksheet><sheetData><row><c r=\"A1\"><v>95</v></c></row></sheetData></worksheet>"
        let excel = zip([Entry(name: "xl/workbook.xml", body: workbook), Entry(name: "xl/_rels/workbook.xml.rels", body: relationships),
                         Entry(name: "xl/sharedStrings.xml", body: "<sst><si><t>Alice</t></si></sst>"),
                         Entry(name: "xl/worksheets/sheet1.xml", body: sheet1), Entry(name: "xl/worksheets/sheet2.xml", body: sheet2)])
        let excelResult = TeamsAttachmentParser.parseSynchronously(data: excel, mimeType: "", name: "grades.xlsx")
        require(status(excelResult) == "read" && text(excelResult).contains("EC Roster\nA1: Alice") && text(excelResult).contains("Math\nA1: 95"), "XLSX relationships, shared strings, numeric grade")
        require(excelResult["error"] as? String == "", "Successful extraction does not report a false error")
        let incompleteExcel = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "xl/worksheets/sheet1.xml", body: sheet1)]), mimeType: "", name: "missing.xlsx")
        require(status(incompleteExcel) == "partial", "Missing shared string not marked fully read")
        let uncachedFormula = "<worksheet><sheetData><row><c r=\"A1\"><f>1+1</f></c><c r=\"A2\"><v>95</v></c></row></sheetData></worksheet>"
        let formulaResult = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "xl/worksheets/sheet1.xml", body: uncachedFormula)]), mimeType: "", name: "formula.xlsx")
        require(status(formulaResult) == "partial" && !text(formulaResult).contains("1+1"), "Missing formula cache not fabricated")
        let traversal = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: word), Entry(name: "../outside", body: "blocked")]), mimeType: "", name: "attack.docx")
        require(status(traversal) == "error" && text(traversal).isEmpty, "ZIP path traversal rejected")
        let duplicate = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: word), Entry(name: "word/document.xml", body: word)]), mimeType: "", name: "duplicate.docx")
        require(status(duplicate) == "error", "ZIP duplicate entries rejected")
        let symlink = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: word, attributes: 0xa1ff0000)]), mimeType: "", name: "symlink.docx")
        require(status(symlink) == "error", "ZIP symlink rejected")
        let bomb = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: word, expanded: 20_000_000)]), mimeType: "", name: "bomb.docx")
        require(status(bomb) == "error", "ZIP declared expansion limit")
        let entity = "<!DOCTYPE document [<!ENTITY external SYSTEM \"https://example.invalid/never-fetch\">]><document>&external;</document>"
        let entityResult = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: entity)]), mimeType: "", name: "entity.docx")
        require(status(entityResult) == "error", "External XML entity declaration rejected")
        let encodedEntity = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: "", bytes: entity.data(using: .utf16LittleEndian))]), mimeType: "", name: "utf16-entity.docx")
        require(status(encodedEntity) == "error", "NUL-interleaved DTD cannot bypass declaration guard")
        let utf16Word = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: "", bytes: word.data(using: .utf16))]), mimeType: "", name: "utf16.docx")
        require(status(utf16Word) == "read" && text(utf16Word).contains("老师反馈"), "Legitimate BOM UTF-16 Office XML")
        let malformed = TeamsAttachmentParser.parseSynchronously(data: zip([Entry(name: "word/document.xml", body: "<w:document><w:t>broken")]), mimeType: "", name: "malformed.docx")
        require(status(malformed) == "error", "Malformed XML not marked read")
        require(status(parse("", name: "empty.txt")) == "no_text", "Empty file not marked read")
        require(JSONSerialization.isValidJSONObject(excelResult) && JSONSerialization.isValidJSONObject(bomb), "Pure JSON success/error results")

        var completed = false
        TeamsAttachmentParser.parse(data: Data("async fixture".utf8), mimeType: "text/plain", name: "async.txt") { value in
            require(Thread.isMainThread && status(value) == "read", "Async parsing completes on UI thread")
            completed = true
        }
        let deadline = Date().addingTimeInterval(5)
        while !completed && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
        require(completed, "Async completion delivered")
        print("PASS: \(passed) attachment fixture checks; all inputs generated locally")
    }
}
