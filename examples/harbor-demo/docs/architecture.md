# Architecture (SAMPLE DATA, fictional Harbor Lane Bikes)

- Docks report state over MQTT to the fleet service.
- Billing runs on Stripe (billing v2). The legacy invoicing service was retired in August 2026.
- The nightly GPS purge job is `jobs/purge_gps.py`.
