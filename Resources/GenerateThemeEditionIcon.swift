import AppKit
import Foundation

private func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: alpha)
}

private func roundedRect(_ rect: CGRect, radius: CGFloat) -> NSBezierPath {
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
}

private func drawIcon() -> NSBitmapImageRep {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB,
                                  bytesPerRow: 0, bitsPerPixel: 0)!
    let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.imageInterpolation = .high

    let tile = roundedRect(CGRect(x: 34, y: 34, width: 956, height: 956), radius: 226)
    let tileShadow = NSShadow()
    tileShadow.shadowColor = color(0x092F2A, alpha: 0.38)
    tileShadow.shadowBlurRadius = 30
    tileShadow.shadowOffset = CGSize(width: 0, height: -18)
    tileShadow.set()
    NSGradient(colors: [color(0x174F47), color(0x207865), color(0x155A50)])!
        .draw(in: tile, angle: 52)
    NSShadow().set()

    // A quiet radial glow gives the monogram depth without adding detail that
    // would disappear at Dock sizes.
    let halo = NSBezierPath(ovalIn: CGRect(x: 154, y: 142, width: 716, height: 716))
    NSGradient(colors: [color(0xB8F6DF, alpha: 0.16), color(0x67C7A7, alpha: 0.025)])!
        .draw(in: halo, angle: 90)

    let innerBorder = roundedRect(CGRect(x: 53, y: 53, width: 918, height: 918), radius: 207)
    color(0xE3FFF4, alpha: 0.24).setStroke()
    innerBorder.lineWidth = 3
    innerBorder.stroke()

    let font = NSFont(name: "Georgia-BoldItalic", size: 650) ?? NSFont.systemFont(ofSize: 650, weight: .bold)
    let letter = NSAttributedString(string: "C", attributes: [
        .font: font,
        .foregroundColor: color(0xE9FFF5),
        .kern: -18
    ])
    let letterBounds = letter.boundingRect(with: NSSize(width: 900, height: 900), options: [])
    let letterShadow = NSShadow()
    letterShadow.shadowColor = color(0x063B34, alpha: 0.38)
    letterShadow.shadowBlurRadius = 15
    letterShadow.shadowOffset = CGSize(width: 1, height: -10)
    letterShadow.set()
    letter.draw(at: CGPoint(x: (1024 - letterBounds.width) / 2 - letterBounds.minX - 10,
                            y: (1024 - letterBounds.height) / 2 - letterBounds.minY + 12))
    NSShadow().set()

    let dot = NSBezierPath(ovalIn: CGRect(x: 716, y: 632, width: 92, height: 92))
    let dotShadow = NSShadow()
    dotShadow.shadowColor = color(0x062E29, alpha: 0.36)
    dotShadow.shadowBlurRadius = 14
    dotShadow.shadowOffset = CGSize(width: 0, height: -5)
    dotShadow.set()
    NSGradient(colors: [color(0xE6FFF4), color(0x9DEBCB)])!.draw(in: dot, angle: 90)
    NSShadow().set()

    color(0xFFFFFF, alpha: 0.58).setFill()
    NSBezierPath(ovalIn: CGRect(x: 738, y: 690, width: 18, height: 18)).fill()

    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: GenerateThemeEditionIcon.swift output.png\n", stderr)
    exit(2)
}
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let png = drawIcon().representation(using: .png, properties: [:])!
try png.write(to: output, options: .atomic)
