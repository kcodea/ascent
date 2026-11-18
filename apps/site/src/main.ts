import './styles/tokens.css';
import './styles/base.css';
import './styles/sections.css';
import { applyPlatform, detectPlatform } from './platform';

document.addEventListener('DOMContentLoaded', () => {
  applyPlatform(document, detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
});
