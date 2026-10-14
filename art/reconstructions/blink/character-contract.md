# Flicker: character contract notes

Read: `grimoire/character/reconstruction.md`, `grimoire/character/likeness_maximization.md`.

- Style axis: chibi figurine. Head and body are one volume, so total height ≈ 1.3 HU if the "head" is taken as the eye-bearing upper half. There are no legs, neck, or separate torso.
- Skeleton: not a humanoid skeleton. The game animates rigid parts (bob, squash, mitt sway), so the rig is a part hierarchy with pivots: root → body → {eye-l, eye-r, belly, antenna → gem, hand-l, hand-r}, root → {foot-l, foot-r}.
- Likeness route: **freehand stylized** (reconstruction.md), not projection-first. The reference is a flat-colour toy with no printed pattern; solid albedo per region matches it better than a projected photo, and projection would bake the concept's studio highlights into a model that is lit in-game by toon shading.
- Eyes: glossy white disc + dark pupil disc + catchlight dot, per reconstruction.md "Eyes".
- Confidence: front 0.85, sides 0.7, back 0.5 (inferred smooth continuation).
