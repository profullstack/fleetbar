// @profullstack/fleetbar: importing this module registers <fleet-bar>.
// Server code lives in @profullstack/fleetbar/server.
import { defineFleetBar } from './element.js';

export { FleetBar, defineFleetBar, STYLES } from './element.js';
export * from './logic.js';

defineFleetBar();
