-- Rename flat config keys to dot-namespaced plugin format
-- Tesla keys (from teslaConfigDef + internalConfigDef)
UPDATE `config` SET `key` = 'tesla.client_id' WHERE `key` = 'tesla_client_id';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.client_secret' WHERE `key` = 'tesla_client_secret';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.region' WHERE `key` = 'tesla_region';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.public_key_domain' WHERE `key` = 'tesla_public_key_domain';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.proxy_url' WHERE `key` = 'tesla_proxy_url';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.ec_public_key_pem' WHERE `key` = 'ec_public_key_pem';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.ec_private_key' WHERE `key` = 'ec_private_key';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.access_token' WHERE `key` = 'tesla_access_token';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.refresh_token' WHERE `key` = 'tesla_refresh_token';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.token_expires_at' WHERE `key` = 'tesla_token_expires_at';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.oauth_origin' WHERE `key` = 'tesla_oauth_origin';--> statement-breakpoint
UPDATE `config` SET `key` = 'tesla.key_paired' WHERE `key` = 'tesla_key_paired';--> statement-breakpoint
-- Fronius Local keys (from equipmentConfigDef)
UPDATE `config` SET `key` = 'fronius_local.host' WHERE `key` = 'fronius_host';--> statement-breakpoint
UPDATE `config` SET `key` = 'fronius_local.meter_device_id' WHERE `key` = 'fronius_meter_device_id';--> statement-breakpoint
-- Fronius Cloud keys (from equipmentConfigDef)
UPDATE `config` SET `key` = 'fronius_cloud.email' WHERE `key` = 'fronius_cloud_email';--> statement-breakpoint
UPDATE `config` SET `key` = 'fronius_cloud.password' WHERE `key` = 'fronius_cloud_password';--> statement-breakpoint
UPDATE `config` SET `key` = 'fronius_cloud.pv_system_id' WHERE `key` = 'fronius_cloud_pv_system_id';
