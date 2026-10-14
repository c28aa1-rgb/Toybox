# Flicker (blink): image analysis

Reference: `art/concepts/blink.png` (1254×1254, AI-generated concept, plain #C9C9C9-ish grey background).
Target use: real-time browser game character, seen from a ~55° top-down camera at roughly 60–90 px tall on screen.

## Layer 1: identification
- Work type: stylized vinyl-toy mascot figure (chibi creature).
- Classification: character, `primaryDomain: character` (non-human, no skeleton beyond rigid parts).
- Confidence: 0.95.

## Layer 2: form & silhouette
- Body: one continuous ovoid / bean volume (superellipsoid), taller than wide (≈ 1.35 : 1 height : width), widest just below mid-height, tapering slightly toward the crown. No neck: the head and body are the same volume.
- Symmetry: bilateral about the sagittal plane (the antenna leans toward the character's left; see layer 8).
- Shape language: fully organic, rounded; no hard edges anywhere except the gem facets.
- Reference dimension: body height H. Body width ≈ 0.74 H, depth ≈ 0.62 H (inferred from 3/4 view).

## Layer 3: macro → meso → micro
- Macro
  - `body` (ovoid trunk/head)
  - `foot-l`, `foot-r` (flattened half-spheroids)
  - `hand-l`, `hand-r` (teardrop mitts)
  - `antenna` (curved stalk + gem)
- Meso
  - `belly-patch` (cream ellipse inlay on the front of `body`)
  - `eye-l`, `eye-r` (white sclera discs, slightly proud of the surface)
  - `antenna-stalk` (curved tube) and `antenna-gem` (elongated octahedron / bipyramid)
- Micro
  - `pupil-l`, `pupil-r` (dark discs, slightly inward and up)
  - `catchlight-l`, `catchlight-r` (tiny white dots on pupils)

## Layer 4: spatial relationships
- `<belly-patch, embedded-in, body front>`: flush, covers ≈ 45% of the front, centred at ≈ 0.38 H.
- `<eye-l/r, embedded-in, body front-upper>`: proud by ≈ 0.02 H, centres at ≈ 0.68 H, separated by ≈ 0.28 H.
- `<pupil, overlap, eye>`: pupils sit on the eye discs, offset toward the nose line.
- `<hand-l/r, attached-to, body lateral>`: overlap contact at ≈ 0.42 H; the right mitt (character's right) is raised forward, the left hangs down along the side.
- `<foot-l/r, below, body>`: butt contact at the base; feet project forward ≈ 0.1 H.
- `<antenna-stalk, socket, body crown>`: rises from the top centre, curves toward the character's left and forward.
- `<antenna-gem, attached-to, antenna-stalk tip>`.

## Layer 5: materials (PBR)
- `body`, `hands`: glossy dielectric plastic. Metalness 0, roughness ≈ 0.25, F0 ≈ 0.04, opaque.
- `belly-patch`: same plastic, slightly more matte (roughness ≈ 0.35).
- `eye` sclera: glossy white plastic (roughness ≈ 0.2).
- `pupil`: glossy near-black (roughness ≈ 0.15).
- `foot`, `antenna-stalk`: glossy dark-violet plastic (roughness ≈ 0.3).
- `antenna-gem`: glossy yellow plastic with flat facets (roughness ≈ 0.25).
- Note: the image has baked studio highlights (white speculars on the crown, mitts, feet). These are lighting, not albedo.

## Layer 6: color & finish
- Body/hands: vivid azure, mid-high value. Target albedo `#4FB3FF` (prompted) — image reads ≈ `#3FA7F5` after de-lighting.
- Belly: warm cream, high value, low saturation ≈ `#F3E6CC`.
- Sclera: off-white `#F6F4EE`. Pupil: very dark brown-black `#1E1414`.
- Feet/stalk: deep violet, low value ≈ `#4A2F78`.
- Gem: saturated yellow, high value ≈ `#FFC21A` with lighter facet `#FFE45C`.
- Finish: gloss throughout. No gradients in albedo; all value change is shading.

## Layer 7: identity-defining features
1. Lightning gem antenna (yellow bipyramid on a curved violet stalk). This is the hero's silhouette signature from top-down.
2. Two oversized eyes with pupils looking up-and-in.
3. Cream belly ellipse.
4. Bean body with no neck.
5. Violet feet peeking out under the body.

## Layer 8: uncertainty & single-view limits
- Back of the body: hidden. Assume smooth continuation of the ovoid with no features (inference).
- Back of the antenna curve: the stalk direction in depth is uncertain; assume it curves forward-left by ≈ 25°.
- Left mitt (character's left) is partly occluded by the body silhouette edge in this 3/4 view; assume mirror of the right mitt shape.
- Gem has 4 or 6 lateral facets; the visible faces suggest an elongated square bipyramid (octahedron stretched on Y). Undetermined, low impact at game scale.
- Pupil placement is a pose choice (looking at camera); in game the eyes should look forward (+Z).
