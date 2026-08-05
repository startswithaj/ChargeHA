import {
  PluginDependencies,
  type PluginDependenciesInit,
} from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import type { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import { TeslaVehiclePlugin } from "./vehicles/tesla/server/index.ts";
import { TeslaProxyManager } from "./vehicles/tesla/server/TeslaProxyManager.ts";
import {
  DATA_ONLY_IDENTITY,
  SimulatedVehiclePlugin,
} from "./vehicles/simulated/server/index.ts";
import { FroniusLocalPlugin } from "./energy/fronius-local/server/index.ts";
import { FroniusCloudPlugin } from "./energy/fronius-cloud/server/index.ts";
import { SigenergyLocalPlugin } from "./energy/sigenergy-local/server/index.ts";
import { EnphaseLocalPlugin } from "./energy/enphase-local/server/index.ts";
import { SimulatedEnergyPlugin } from "./energy/simulated/server/index.ts";
import { TapoChargerPlugin } from "./chargers/tapo/server/index.ts";
import { OcppChargerPlugin } from "./chargers/ocpp/server/index.ts";
import { SimulatedChargerPlugin } from "./chargers/simulated/server/index.ts";

/**
 * Instantiate every plugin the app supports and register each with its
 * registry. Plugins self-initialize in their constructors via the
 * `PluginDependencies` handed to them here.
 *
 * The encryption key does not appear in this signature on purpose — secret
 * storage is encapsulated inside `AppDatabase`.
 */
export function registerPlugins(
  host: Omit<PluginDependenciesInit, "pluginId">,
  vehicleRegistry: VehiclePluginRegistry,
  energyRegistry: EnergyPluginRegistry,
  chargerRegistry: ChargerPluginRegistry,
): void {
  const make = (id: string) =>
    PluginDependencies.create({ ...host, pluginId: id });

  const teslaDeps = make("tesla");
  // The same instance registers in both registries: one adapter, one
  // cost-aware layer, a thin charger view on top (see tesla-split doc).
  const teslaPlugin = new TeslaVehiclePlugin(
    teslaDeps,
    new TeslaProxyManager(teslaDeps, teslaDeps.log),
  );
  vehicleRegistry.register(teslaPlugin);
  chargerRegistry.register(teslaPlugin);

  const simulatedPlugin = new SimulatedVehiclePlugin(make("simulated"));
  vehicleRegistry.register(simulatedPlugin);
  chargerRegistry.register(simulatedPlugin);

  // Vehicle role only — no charging point is ever created for it.
  vehicleRegistry.register(
    new SimulatedVehiclePlugin(
      make(DATA_ONLY_IDENTITY.id),
      DATA_ONLY_IDENTITY,
    ),
  );

  energyRegistry.register(new FroniusLocalPlugin(make("fronius_local")));
  energyRegistry.register(new FroniusCloudPlugin(make("fronius_cloud")));
  energyRegistry.register(new SigenergyLocalPlugin(make("sigenergy_local")));
  energyRegistry.register(new EnphaseLocalPlugin(make("enphase_local")));
  energyRegistry.register(
    new SimulatedEnergyPlugin(make("simulated_energy")),
  );
  chargerRegistry.register(new TapoChargerPlugin(make("tapo")));
  chargerRegistry.register(new OcppChargerPlugin(make("ocpp")));
  chargerRegistry.register(
    new SimulatedChargerPlugin(make("simulated_charger")),
  );
}
