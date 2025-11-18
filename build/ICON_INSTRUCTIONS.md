Snapback app icon setup (macOS)
================================

Electron Builder is configured to look for the macOS app icon at:

  build/icon.icns

Follow these quick steps on macOS to generate it from the existing SVG:

1. Open `src/renderer/icon.svg` in Preview.
2. In Preview, choose **File → Export…** and:
   - Format: PNG
   - Resolution: 1024 x 1024 pixels (or higher, square)
   - Save as: `icon_1024.png` somewhere (e.g. Desktop).
3. Create an iconset folder in this project:

   mkdir -p build/snapback.iconset

4. Copy and downscale the PNG into the standard icon sizes:

   cd build/snapback.iconset
   cp /path/to/icon_1024.png icon_512x512@2x.png
   sips -z 512 512 icon_512x512@2x.png --out icon_512x512.png
   sips -z 256 256 icon_512x512.png --out icon_256x256.png
   sips -z 256 256 icon_512x512@2x.png --out icon_256x256@2x.png
   sips -z 128 128 icon_256x256.png --out icon_128x128.png
   sips -z 128 128 icon_256x256@2x.png --out icon_128x128@2x.png
   sips -z 64 64 icon_128x128.png --out icon_32x32@2x.png
   sips -z 32 32 icon_128x128.png --out icon_32x32.png
   sips -z 16 16 icon_32x32.png --out icon_16x16.png
   cp icon_32x32.png icon_16x16@2x.png

5. Use `iconutil` to build the `.icns` file:

   cd ..
   iconutil -c icns snapback.iconset -o icon.icns

Now `build/icon.icns` exists and `npm run dist` will embed it as the macOS app / dock icon.


