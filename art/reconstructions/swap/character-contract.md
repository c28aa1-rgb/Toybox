# Switch: character contract notes

Read: `grimoire/character/reconstruction.md`, `grimoire/character/likeness_maximization.md` (same as Flicker).

- Chibi single-volume body, so proportions are fractions of figure height, not head units.
- Rigid part hierarchy (no skinned mesh): root -> body -> eyes/mitts/accessories, root -> feet.
- Freehand stylized route, not projection: flat-colour toy, solid albedo per region; colour regions
  with hard edges (belly, mask) are vertex-painted on the body, per `_shared/vertex_paint.py`.
- Base body/eye/mitt/foot dimensions reuse Flicker's measured and reviewed parts; this hero is
  reviewed against its own reference in every pass.
