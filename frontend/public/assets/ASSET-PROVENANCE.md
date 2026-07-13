# Real GLB demo-asset provenance

The comparison, complexity, animation, morph, and compressed-delivery models come from Khronos Group's `glTF-Sample-Assets` repository and Poly Haven's CC0 model library. Every upstream license record is stored beside the binaries in this directory.

## Avocado

- Source: `Models/Avocado/glTF-Binary/Avocado.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado
- Source SHA-256: `ccc9c3ce56423720b09399c2351537207cd5a65f859f9e6e2f30922762f3abd4`
- Project derivative SHA-256: `5d36edd89e44331da003f181b6fb3a2a98303922600e3093b213e78913415af7`
- Deliberate visible delta: base-color multiplier `1.00 / 0.32 / 0.18` (orange grade)

## Boom Box

- Source: `Models/BoomBox/glTF-Binary/BoomBox.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BoomBox
- Source SHA-256: `f8b918445ebdd006768232205a62f5182d2208ca57f84c6ccc084943c0bc8f15`
- Project derivative SHA-256: `1aa49e3fe779e292d39bcc0a71b0d297a098ccfbba5094fb46a162e59ce4f9a4`
- Deliberate visible delta: blue base-color grade plus emissive factor `0.25 / 0.55 / 1.00`

## Barramundi Fish

- Source: `Models/BarramundiFish/glTF-Binary/BarramundiFish.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish
- Source SHA-256: `ecc3bafb6b00f2c8b810863c388e3768a7b7ea0d0335e8cb8c574c266e571f4a`
- Project derivative SHA-256: `1a4f497e657dcc33fc55c02fcbd7b5d610ab72b8f8b7ae8764ef69d9e20ed477`
- Deliberate visible delta: base-color multiplier `0.20 / 0.55 / 1.00` plus roughness factor `0.18`

## Water Bottle

- Source: `Models/WaterBottle/glTF-Binary/WaterBottle.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle
- Source SHA-256: `b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b`
- Project derivative SHA-256: `c56c3cc4960e746e59b7e2e5900ae168308b263c5a0eb384365f4bce3fcc1480`
- Deliberate visible delta: base-color multiplier `0.12 / 0.45 / 1.00` (strong blue grade)

## Lantern

- Source: `Models/Lantern/glTF-Binary/Lantern.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern
- Source SHA-256: `a79458c4b02d695187a952f23a63b8bf278e7bc3d316a3c2a314f2d6974181f1`
- Project derivative SHA-256: `82c28632e61ce14a173515e69b6f1c22b77092be817feee5548e530b30393515`
- Deliberate visible delta: base-color multiplier `0.12 / 0.45 / 1.00` plus roughness factor `0.12`

## Reproducible project derivatives

`npm run assets:derive` runs `scripts/derive-glb-assets.mjs`. It preserves each model's original geometry, textures, and binary chunks while applying the single documented material-factor change above and adding Northwind project/import metadata to the GLB JSON chunk. The controlled deltas make the registered comparison demonstrable and reproducible.

For every model, the three records shown in CreatorFlow form one evidence chain: upstream source model, repository distribution record, and local import record. They are deliberately not presented as three independent ownership claims.

## A Beautiful Game — source-only stress asset

- Source: `Models/ABeautifulGame/glTF-Binary/ABeautifulGame.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame
- License: CC BY 4.0; MaterialX Project / ASWF, conversion by Ed Mackey
- SHA-256: `bd7133b4b322aae97c589b8839dae8155ad2546acb35ae32a127e722a959d007`
- Payload: 42,977,928 bytes; 49 nodes, 15 meshes, 15 materials, 38 textures, 33 embedded images
- Component evidence: seven selectable same-file relationships, including four 100% shared-mesh instances and three exact-geometry/material-variant pairs

## Dutch Ship Large 01 — source-only stress asset

- Source package: Poly Haven 4K glTF
- Source record: https://polyhaven.com/a/dutch_ship_large_01
- License: CC0 1.0 Universal
- Authors: James Ray Cock, Nicolò Zubbini, Rico Cilliers
- SHA-256: `968d8713cceebd13c8f36231f1368b11050537a8c2889e9c652ce2c275f08bf2`
- Payload: 107,145,484 bytes; 3 nodes, 3 meshes, 110,616 triangles, 3 materials, 9 embedded 4K images
- Component evidence: hull, rigging, and sails mapped to Dutch Ship Large 02

## Dutch Ship Large 02 — source-only stress asset

- Source package: Poly Haven 4K glTF
- Source record: https://polyhaven.com/a/dutch_ship_large_02
- License: CC0 1.0 Universal
- Authors: James Ray Cock, Nicolò Zubbini, Rico Cilliers
- SHA-256: `5bad7161f9ed1b7614621303c82730f6666c8fcbde17522220cc365aa2878ba8`
- Payload: 106,163,560 bytes; 3 nodes, 3 meshes, 96,506 triangles, 3 materials, 9 embedded 4K images
- Component evidence: hull, rigging, and sails mapped to Dutch Ship Large 01

## Mosquito in Amber — source-only stress asset

- Source: `Models/MosquitoInAmber/glTF-Binary/MosquitoInAmber.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MosquitoInAmber
- License: CC BY 4.0; Loïc Norgeot / Sketchfab, mosquito scan by Geoffrey Marchal
- SHA-256: `1c0b49000650e8a8c00d69bc8d64e46d33527871a47d74e4f2278887325cc35f`
- Payload: 24,229,904 bytes; 10 nodes, 3 meshes, 3 materials, 5 textures, 5 embedded images

## Node Performance Test — source-only stress asset

- Source: `Models/NodePerformanceTest/glTF-Binary/NodePerformanceTest.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/NodePerformanceTest
- License: CC0 1.0 Universal; Jon Aspeheim
- SHA-256: `81eec3b14b8ed25068448ffdc824528d03f1e844b20e017f5c3aab3f076b1fb8`
- Payload: 37,986,536 bytes; 10,002 nodes, 10,000 meshes, 10,000 primitives, 10,000 materials, 10,000 texture references, 100 embedded images

## Corset — source-only stress asset

- Source: `Models/Corset/glTF-Binary/Corset.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Corset
- License: CC0 1.0 Universal; Microsoft / UX3D
- SHA-256: `9582c0dc0dee813be77f60e6ddf7213987c7e11497bf3cc66fd7b18957ae0d26`
- Payload: 13,491,364 bytes; 1 node, 1 mesh, 1 primitive, 1 material, 3 textures, 3 embedded images

## Fox — animation stress asset

- Source: `Models/Fox/glTF-Binary/Fox.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
- License: CC0 model; CC BY 4.0 rig, animation, and glTF conversion
- SHA-256: `d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7`
- Payload: 162,852 bytes; one skin and three mutually exclusive animation cycles: Survey, Walk, and Run

## Morph Stress Test — animation stress asset

- Source: `Models/MorphStressTest/glTF-Binary/MorphStressTest.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MorphStressTest
- License: CC BY 4.0; Analytical Graphics / Ed Mackey
- SHA-256: `005f1d9dd938c553a506d6bf3d21830fc3f2ec3a199d9332e9a625baf7342bef`
- Payload: 575,900 bytes; eight morph targets and three animation modes: Individuals, TheWave, and Pulse

## A Beautiful Game — Draco + KTX2 delivery variant

- Source: `Models/ABeautifulGame/glTF-Binary-KTX-ETC1S-Draco/ABeautifulGame.glb`
- Source record: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame
- License: Same CC BY 4.0 record as the uncompressed A Beautiful Game source
- SHA-256: `d950162d41e0064be9dfac0c09d80c7a23719a37af37f08cd79385b8af0af0c1`
- Payload: 12,105,252 bytes; 71.8% smaller than the 42,977,928-byte uncompressed GLB

The stress assets are never fetched on workspace entry. Their screenshots, metrics, and component-match records render first; binaries are transferred and decoded only after the user requests an interactive preview or cross-file component comparison.
