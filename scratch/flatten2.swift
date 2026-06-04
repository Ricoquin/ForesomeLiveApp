import AppKit

func flattenIcon(inputPath: String, outputPath: String, size: Int) {
    guard let srcImage = NSImage(contentsOfFile: inputPath) else {
        print("Failed to load \(inputPath)"); return
    }
    let s = CGFloat(size)
    let newImage = NSImage(size: NSSize(width: s, height: s))
    newImage.lockFocus()
    NSColor(red: 26/255.0, green: 44/255.0, blue: 32/255.0, alpha: 1.0).setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    srcImage.draw(in: NSRect(x: 0, y: 0, width: s, height: s),
                  from: NSRect(origin: .zero, size: srcImage.size),
                  operation: .sourceOver, fraction: 1.0)
    newImage.unlockFocus()
    
    guard let tiffData = newImage.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiffData) else { return }
    
    // Create a new rep without alpha
    let noAlphaRep = NSBitmapImageRep(bitmapDataPlanes: nil,
        pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 3,
        hasAlpha: false, isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: size * 3, bitsPerPixel: 24)!
    
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: noAlphaRep)
    NSColor(red: 26/255.0, green: 44/255.0, blue: 32/255.0, alpha: 1.0).setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    rep.draw(in: NSRect(x: 0, y: 0, width: s, height: s))
    NSGraphicsContext.restoreGraphicsState()
    
    let pngData = noAlphaRep.representation(using: .png, properties: [:])!
    try! pngData.write(to: URL(fileURLWithPath: outputPath))
    print("Created \(outputPath) at \(size)x\(size)")
}

let base = "/Users/ricoquin/Downloads/foreSomeV1App"
flattenIcon(inputPath: base + "/app-icon.png", outputPath: base + "/public/icons/icon-512.png", size: 512)
flattenIcon(inputPath: base + "/app-icon.png", outputPath: base + "/public/icons/icon-192.png", size: 192)
flattenIcon(inputPath: base + "/app-icon.png", outputPath: base + "/public/icons/apple-touch-icon.png", size: 180)
print("✅ All icons done - no alpha")
