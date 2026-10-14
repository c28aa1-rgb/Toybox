import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import { App } from './ui/App';
import { registerGunModels, registerHeroModels } from './models';
import './theme/tokens.css';
import './theme/app.css';

registerHeroModels();
registerGunModels();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
