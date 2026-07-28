import React from 'react';
import { Composition } from 'remotion';
import { Explainer, TOTAL_FRAMES } from './Explainer';
import { FPS } from './theme';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Explainer"
    component={Explainer}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
