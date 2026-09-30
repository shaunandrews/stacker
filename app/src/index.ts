import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { initSplash } from './splash.js';
import { StackerSystem } from './stacker-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  initSplash(world);
  world.registerSystem(StackerSystem);
});
