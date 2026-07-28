import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The explainer is flat colour and type, so a high CRF still looks clean and keeps the file small
// enough to attach to a README or a message.
Config.setCrf(18);
