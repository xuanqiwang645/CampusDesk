import Foundation

@main
enum ManifestTool {
    static func main() throws {
        if CommandLine.arguments.count == 5, CommandLine.arguments[1] == "--catalog" {
            let variants = try CommandLine.arguments[2...3].map { try JSONDecoder().decode(PatchManifest.self, from: Data(contentsOf: URL(fileURLWithPath: $0))) }
            guard Set(variants.map(\.bundleID)) == Set(PatchEdition.allCases.map(\.rawValue)), Set(variants.map(\.build)).count == 1,
                  Set(variants.map(\.version)).count == 1, Set(variants.map(\.signingCertificateSHA1)).count == 1 else { throw PatchError.invalid("Variant mismatch") }
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(PatchCatalog(formatVersion: 2, variants: variants)).write(to: URL(fileURLWithPath: CommandLine.arguments[4]), options: .atomic)
            return
        }
        guard CommandLine.arguments.count == 4 else { throw PatchError.invalid("Expected app archive manifest") }
        let app = URL(fileURLWithPath: CommandLine.arguments[1]), archive = URL(fileURLWithPath: CommandLine.arguments[2])
        let info = try PatchFiles.info(app)
        guard let bundleID = info["CFBundleIdentifier"] as? String, let edition = PatchEdition(rawValue: bundleID),
              let version = info["CFBundleShortVersionString"] as? String,
              let text = info["CFBundleVersion"] as? String, let build = Int(text) else { throw PatchError.invalid("Invalid payload") }
        let manifest = PatchManifest(formatVersion: 1, bundleID: bundleID, appName: edition.appName, version: version, build: build, architecture: "arm64",
            archiveSHA256: try PatchFiles.digest(archive), appTreeSHA256: try PatchFiles.treeDigest(app),
            credentialHelperSHA256: try PatchFiles.digest(app.appendingPathComponent(PatchFiles.helperPath)), signingCertificateSHA1: try PatchFiles.certificateSHA1(app))
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(manifest).write(to: URL(fileURLWithPath: CommandLine.arguments[3]), options: .atomic)
    }
}
