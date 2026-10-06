import type { ScriptTemplate } from '../templates';
import { mirrors, popupLights, seats, wipers } from './body';
import { ambientLights, brakeFlash, welcomeLights, windNoise } from './cabin';
import { headUnit } from './display';
import { convertible, sunroof, windows } from './openings';
import { activeAero, launchControl, popsAndBangs, shiftLight } from './performance';
import { centralLocking, daytimeLights, gaugeNeedle, gearDisplay, lowFuelWarning, seatbeltReminder, tripComputer } from './extras';

/** Every built-in template, in the order the gallery shows them. */
export const BUILT_IN_TEMPLATES: readonly ScriptTemplate[] = [wipers, windows, mirrors, sunroof, convertible, seats, popupLights, welcomeLights, ambientLights, activeAero, launchControl, popsAndBangs, shiftLight, windNoise, brakeFlash, headUnit, centralLocking, daytimeLights, seatbeltReminder, lowFuelWarning, gaugeNeedle, gearDisplay, tripComputer];
