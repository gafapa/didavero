# App icon

The app mark is a folded white note with three violet lines and an amber pencil on a violet rounded square. The pencil's diagonal gives the mark a clear silhouette; the note represents the material being authored. The interface's existing violet and amber palette remains in use.

`build/icono.svg` is the full vector source. `build/icono-pequeno.svg` uses a 16-unit grid and fewer pencil details for sizes up to 32 pixels. The React `Logo` component reproduces the mark with theme tokens and includes an inverted variant for accent-colored surfaces. The standalone activity sparkle remains a separate symbol.

Run `npm run iconos` to render the 1024-pixel desktop PNG, the 128-pixel favicon and a Windows ICO containing 16, 20, 24, 32, 40, 48, 64, 128 and 256-pixel versions. These are local canvas renders of the authored SVG sources, not externally generated images. Windows uses the ICO for its application window; other platforms use the PNG. The public website has its own mark in `website/assets/mark.svg`.
