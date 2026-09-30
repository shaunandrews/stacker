import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { StackerSystem } from './stacker-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(StackerSystem);
});
