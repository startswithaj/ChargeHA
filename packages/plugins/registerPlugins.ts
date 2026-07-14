import { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import type { AppDatabase } from "@chargeha/server/db";
import type { VehicleManager } from "@chargeha/server/services/VehicleManager";
import type { EnergyAdapterManager } from "@chargeha/server/services/EnergyAdapterManager";
import { TeslaVehiclePlugin } from "./vehicles/tesla/server/index.ts";
import { TeslaProxyManager } from "./vehicles/tesla/server/TeslaProxyManager.ts";
import { SimulatedVehiclePlugin } from "./vehicles/simulated/server/index.ts";
import { FroniusLocalPlugin } from "./energy/fronius-local/server/index.ts";
import { FroniusCloudPlugin } from "./energy/fronius-cloud/server/index.ts";
import { SigenergyLocalPlugin } from "./energy/sigenergy-local/server/index.ts";
import { EnphaseLocalPlugin } from "./energy/enphase-local/server/index.ts";
import { SimulatedEnergyPlugin } from "./energy/simulated/server/index.ts";

/**
 * Instantiate every plugin the app supports and register each with its
 * registry. Plugins self-initialize in their constructors via the
 * `PluginDependencies` handed to them here.
 *
 * The encryption key does not appear in this signature on purpose — secret
 * storage is encapsulated inside `AppDatabase`.
 */
export function registerPlugins(
  db: AppDatabase,
  vehicleManager: VehicleManager,
  energyManager: EnergyAdapterManager,
  getTunnelUrl: () => string | null,
  vehicleRegistry: VehiclePluginRegistry,
  energyRegistry: EnergyPluginRegistry,
): void {
  const make = (id: string) =>
    PluginDependencies.create(
      db,
      vehicleManager,
      energyManager,
      getTunnelUrl,
      id,
    );

  const teslaDeps = make("tesla");
  vehicleRegistry.register(
    new TeslaVehiclePlugin(
      teslaDeps,
      new TeslaProxyManager(teslaDeps, teslaDeps.log),
    ),
  );
  vehicleRegistry.register(new SimulatedVehiclePlugin(make("simulated")));
  energyRegistry.register(new FroniusLocalPlugin(make("fronius_local")));
  energyRegistry.register(new FroniusCloudPlugin(make("fronius_cloud")));
  energyRegistry.register(new SigenergyLocalPlugin(make("sigenergy_local")));
  energyRegistry.register(new EnphaseLocalPlugin(make("enphase_local")));
  energyRegistry.register(
    new SimulatedEnergyPlugin(make("simulated_energy")),
  );
}
