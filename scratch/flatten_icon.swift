import AppKit

func flattenIcon(inputPath: String, outputPath: String, size: Int) {
    guard let srcImage = NSImage(contentsOfFile: inputPath) else {
        print("Failed to load \(inputPath)")
        return
    }
    
    let s = CGFloat(size)
    let newImage = NSImage(size: NSSize(width: s, height: s))
    newImage.lockFocus()
    
    // Fill solid dark green background
    NSColor(calibratedRed: 26/255, green: 44/255, blue: 32/255, alpha: 1.0).setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    
    // Draw the icon on top
    srcImage.draw(in: NSRect(x: 0, y: 0, width: s, height: s),
                  from: NSRect(origin: .zero, size: srcImage.size),
                  operation: .sourceOver,
                  fraction: 1.0)
    
    newImage.unlockFocus()
    
    // Save as PNG
    guard let tiffData = newImage.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiffData),
          let pngData = rep.representation(using: .png, properties: [:]) else {
        print("Failed to create PNG")
        return
    }
    
    try! pngData.write(to: URL(fileURLWithPath: outputPath))
    print("Created \(outputPath) at \(size)x\(size)")
}

let base = "/Users/ricoquin/Downloads/foreSomeV1App"
let input = base + "/app-icon.png"

flattenIcon(inputPath: input, outputPath: base + "/public/icons/icon-512.png", size: 512)
flattenIcon(inputPath: input, outputPath: base + "/public/icons/icon-192.png", size: 192)
flattenIcon(inputPath: input, outputPath: base + "/public/icons/apple-touch-icon.png", size: 180)
print("✅ All icons flattened")
