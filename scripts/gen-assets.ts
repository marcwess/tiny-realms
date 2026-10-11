import { writeFileSync } from 'node:fs';
import { bowPng, titlePng } from './title-art.ts';

const root = new URL('../client/public/assets/', import.meta.url);
writeFileSync(new URL('bow.png', root), bowPng());
writeFileSync(new URL('title-bg.png', root), titlePng());
console.log('wrote bow.png and title-bg.png');
