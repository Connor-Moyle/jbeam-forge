import type { TestScenario } from '@shared/lua/templates';

/** Driving scenarios any script can be tested in (plus a template's own). */
export const SCENARIOS: { id: string; label: string; scenario: TestScenario }[] = [
  {
    id: 'city',
    label: 'City drive: pull away, cruise, stop',
    scenario: {
      seconds: 20,
      tracks: [
        { name: 'wheelspeed', points: [[0, 0], [5, 13], [12, 14], [16, 0], [20, 0]] },
        { name: 'rpm', points: [[0, 800], [2, 3200], [5, 2200], [12, 2000], [16, 850], [20, 800]] },
        { name: 'throttle', points: [[0, 0], [0.5, 0.6], [5, 0.2], [12, 0.2], [12.5, 0], [20, 0]] },
        { name: 'brake', points: [[0, 0], [12.5, 0], [13, 0.5], [16, 0.4], [16.5, 0], [20, 0]] },
        { name: 'ignitionLevel', points: [[0, 2], [20, 2]] },
      ],
      presses: [],
    },
  },
  {
    id: 'motorway',
    label: 'Motorway: up to 130 km/h and back',
    scenario: {
      seconds: 30,
      tracks: [
        { name: 'wheelspeed', points: [[0, 0], [12, 36], [22, 36], [30, 10]] },
        { name: 'airspeed', points: [[0, 0], [12, 36], [22, 36], [30, 10]] },
        { name: 'rpm', points: [[0, 900], [3, 5500], [6, 4200], [12, 3400], [22, 3300], [30, 1500]] },
        { name: 'throttle', points: [[0, 1], [12, 0.5], [22, 0.4], [22.5, 0], [30, 0]] },
        { name: 'brake', points: [[0, 0], [23, 0], [24, 0.3], [30, 0.3]] },
      ],
      presses: [],
    },
  },
  {
    id: 'stop',
    label: 'Emergency stop from 100 km/h',
    scenario: {
      seconds: 10,
      tracks: [
        { name: 'wheelspeed', points: [[0, 28], [3, 28], [6.5, 0], [10, 0]] },
        { name: 'brake', points: [[0, 0], [3, 0], [3.05, 1], [7, 1], [10, 0]] },
        { name: 'rpm', points: [[0, 3000], [3, 3000], [6.5, 800], [10, 800]] },
      ],
      presses: [],
    },
  },
  {
    id: 'parked',
    label: 'Parked: doors open and close, ignition off',
    scenario: {
      seconds: 16,
      tracks: [
        { name: 'wheelspeed', points: [[0, 0], [16, 0]] },
        { name: 'ignitionLevel', points: [[0, 2], [4, 2], [4.01, 0], [16, 0]] },
        { name: 'lights', points: [[0, 1], [16, 1]] },
        { name: 'door_FL_coupler_notAttached', points: [[0, 0], [6, 0], [6.01, 1], [10, 1], [10.01, 0], [16, 0]] },
        { name: 'door_FR_coupler_notAttached', points: [[0, 0], [7, 0], [7.01, 1], [9, 1], [9.01, 0], [16, 0]] },
      ],
      presses: [],
    },
  },
  {
    id: 'revs',
    label: 'Revving to the limiter',
    scenario: {
      seconds: 8,
      tracks: [
        { name: 'rpm', points: [[0, 900], [3, 7200], [4, 7200], [5, 900], [6, 7200], [7, 900], [8, 900]] },
        { name: 'throttle', points: [[0, 1], [4, 1], [4.1, 0], [5, 1], [6, 1], [6.1, 0], [8, 0]] },
      ],
      presses: [],
    },
  },
];
