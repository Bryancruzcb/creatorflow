import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The CRF lives on the mp4 render script rather than here. `Config.setCrf` applies to every
// render, and the gif codec rejects a crf outright — set globally, it fails `npm run render:gif`
// at validation before a single frame is drawn.
