#!/usr/bin/env bash
# One-time GCP setup for Whim (design D17, D20, D24, D25). Run by the orchestrator, never by a task:
#
#   deploy/provision.sh                    VM on the standard profile's machine type
#   deploy/provision.sh --profile <name>   VM on that profile's machine type
#
# Idempotent: each resource is described first and created only when missing. It adopts the reserved
# static address whose IP is WHIM_STATIC_IP and fails when none exists (it never creates one). It
# creates the OpenRouter secret empty and never adds a version: the owner sets the key.
#
# Alerts (developer-observability D10): the email channel, the uptime check, the log-based metric
# and the alert policies are the committed definitions in deploy/monitoring/, applied by display
# name (by name for the metric) through deploy/lib.sh's whim_apply_monitoring, which every plain
# deploy/cloudrun/deploy.sh runs too. Each carries a fingerprint of its rendered definition, so a
# rerun creates what is missing, updates what changed and leaves the rest alone. The same holds for
# the billing budget, the disk's daily snapshot schedule and the private source-map bucket.
set -euo pipefail

WHIM_SCRIPT=provision.sh
WHIM_USAGE='usage: deploy/provision.sh [--profile <name>]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

profile=standard
while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      [ "$#" -ge 2 ] || whim_usage_error "--profile needs a name"
      profile="$2"
      shift 2
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done
profile_file="$(whim_profile_file "$profile")"
if ! [[ "$profile" =~ ^[a-z0-9-]+$ ]] || [ ! -f "$profile_file" ]; then
  whim_fail "no profile named $profile in deploy/profiles/"
fi
whim_profile_lookup "$profile_file" WHIM_PROFILE_MACHINE_TYPE
readonly machine_type="$WHIM_PROFILE_FOUND_VALUE"
[ -n "$machine_type" ] || whim_fail "profile $profile sets no WHIM_PROFILE_MACHINE_TYPE"

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE WHIM_STATIC_IP WHIM_API_HOST WHIM_WEB_HOST \
  WHIM_ALERT_EMAIL WHIM_BILLING_ACCOUNT WHIM_MONTHLY_BUDGET
whim_require_host_values
# These land in JSON and in gcloud flags, so each is held to a shape that needs no escaping.
readonly EMAIL_SHAPE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
[[ "$WHIM_ALERT_EMAIL" =~ $EMAIL_SHAPE ]] || whim_fail "WHIM_ALERT_EMAIL is not an email address: $WHIM_ALERT_EMAIL"
[[ "$WHIM_BILLING_ACCOUNT" =~ ^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$ ]] \
  || whim_fail "WHIM_BILLING_ACCOUNT is not a billing account id (XXXXXX-XXXXXX-XXXXXX): $WHIM_BILLING_ACCOUNT"
[[ "$WHIM_MONTHLY_BUDGET" =~ ^[1-9][0-9]{0,6}$ ]] \
  || whim_fail "WHIM_MONTHLY_BUDGET must be a whole number in the billing account's currency: $WHIM_MONTHLY_BUDGET"

readonly project="$WHIM_GCP_PROJECT" region="$WHIM_GCP_REGION" zone="$WHIM_GCP_ZONE"
readonly vm_service_account="$WHIM_VM_SERVICE_ACCOUNT_NAME@$project.iam.gserviceaccount.com"
# Google's IAP TCP forwarding range: SSH is reachable only through IAP.
readonly IAP_RANGE=35.235.240.0/20
readonly SNAPSHOT_POLICY=whim-data-daily SNAPSHOT_KEEP_DAYS=14
# Release builds' Hermes source maps (developer-observability D12): private, uploaded by the release scripts.
readonly SOURCEMAP_BUCKET="gs://$project-sourcemaps"
# Logs are stored in the region, not Cloud Logging's global default: the legal pages say Google keeps
# them in Montreal (docs/legal/quebec-s17-assessment.md section 7).
readonly LOG_BUCKET=whim-logs LOG_KEEP_DAYS=30
readonly BUDGET_DISPLAY_NAME="Whim monthly spend"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

exists() {
  "$@" >/dev/null 2>&1
}

echo "==> static address $WHIM_STATIC_IP"
address_row="$(whim_gcloud compute addresses list --filter="region:$region AND address=$WHIM_STATIC_IP" \
  --format='csv[no-heading](name,status)')"
[ -n "$address_row" ] \
  || whim_fail "no reserved address in $region holds $WHIM_STATIC_IP; provision.sh adopts the owner's reserved address and never creates one"
readonly address_name="${address_row%%,*}" address_status="${address_row#*,}"
vm_exists=0
if exists whim_gcloud compute instances describe "$WHIM_VM_NAME" --zone "$zone"; then
  vm_exists=1
fi
if [ "$address_status" = IN_USE ] && [ "$vm_exists" -eq 0 ]; then
  whim_fail "reserved address $address_name ($WHIM_STATIC_IP) is already in use by another resource"
fi
echo "adopting $address_name ($address_status)"

echo "==> services"
whim_gcloud services enable compute.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com iap.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  storage.googleapis.com billingbudgets.googleapis.com

echo "==> artifact registry repository $WHIM_REGISTRY_REPO"
exists whim_gcloud artifacts repositories describe "$WHIM_REGISTRY_REPO" --location "$region" \
  || whim_gcloud artifacts repositories create "$WHIM_REGISTRY_REPO" --location "$region" --repository-format docker \
    --description "Whim server images"

echo "==> service account $vm_service_account"
exists whim_gcloud iam service-accounts describe "$vm_service_account" \
  || whim_gcloud iam service-accounts create "$WHIM_VM_SERVICE_ACCOUNT_NAME" --display-name "Whim VM"
# The VM pulls images and writes logs and metrics. It gets no Secret Manager role.
for role in roles/logging.logWriter roles/monitoring.metricWriter; do
  whim_gcloud projects add-iam-policy-binding "$project" --member "serviceAccount:$vm_service_account" \
    --role "$role" --condition None >/dev/null
done
whim_gcloud artifacts repositories add-iam-policy-binding "$WHIM_REGISTRY_REPO" --location "$region" \
  --member "serviceAccount:$vm_service_account" --role roles/artifactregistry.reader >/dev/null

echo "==> cloud build service account"
build_service_account="$(whim_gcloud builds get-default-service-account --format='value(serviceAccountEmail)')"
build_service_account="${build_service_account##*/}"
[ -n "$build_service_account" ] || whim_fail "cannot read Cloud Build's default service account"
whim_gcloud projects add-iam-policy-binding "$project" --member "serviceAccount:$build_service_account" \
  --role roles/cloudbuild.builds.builder --condition None >/dev/null

echo "==> network $WHIM_NETWORK_NAME"
exists whim_gcloud compute networks describe "$WHIM_NETWORK_NAME" \
  || whim_gcloud compute networks create "$WHIM_NETWORK_NAME" --subnet-mode custom
exists whim_gcloud compute networks subnets describe "$WHIM_SUBNET_NAME" --region "$region" \
  || whim_gcloud compute networks subnets create "$WHIM_SUBNET_NAME" --network "$WHIM_NETWORK_NAME" --region "$region" \
    --range 10.10.0.0/24
exists whim_gcloud compute firewall-rules describe whim-allow-web \
  || whim_gcloud compute firewall-rules create whim-allow-web --network "$WHIM_NETWORK_NAME" --direction INGRESS \
    --action allow --rules tcp:80,tcp:443,udp:443 --source-ranges 0.0.0.0/0 --target-tags whim-vm
exists whim_gcloud compute firewall-rules describe whim-allow-iap-ssh \
  || whim_gcloud compute firewall-rules create whim-allow-iap-ssh --network "$WHIM_NETWORK_NAME" --direction INGRESS \
    --action allow --rules tcp:22 --source-ranges "$IAP_RANGE" --target-tags whim-vm

echo "==> data disk $WHIM_DATA_DISK_NAME"
exists whim_gcloud compute disks describe "$WHIM_DATA_DISK_NAME" --zone "$zone" \
  || whim_gcloud compute disks create "$WHIM_DATA_DISK_NAME" --zone "$zone" --size 20GB --type pd-balanced

echo "==> snapshot schedule $SNAPSHOT_POLICY (daily, keep $SNAPSHOT_KEEP_DAYS) on $WHIM_DATA_DISK_NAME"
if keep_days="$(whim_gcloud compute resource-policies describe "$SNAPSHOT_POLICY" --region "$region" \
  --format='value(snapshotSchedulePolicy.retentionPolicy.maxRetentionDays)' 2>/dev/null)"; then
  # A resource policy can't be edited in place: a different one is the owner's to replace.
  [[ "$keep_days" = "$SNAPSHOT_KEEP_DAYS" ]] \
    || whim_fail "resource policy $SNAPSHOT_POLICY keeps snapshots $keep_days days, not $SNAPSHOT_KEEP_DAYS; detach and delete it, then rerun"
  echo "unchanged resource policy $SNAPSHOT_POLICY"
else
  whim_gcloud compute resource-policies create snapshot-schedule "$SNAPSHOT_POLICY" --region "$region" \
    --description "Daily snapshot of $WHIM_DATA_DISK_NAME (docs/deploy.md, Persistent-disk snapshots)" \
    --daily-schedule --start-time 07:00 --max-retention-days "$SNAPSHOT_KEEP_DAYS"
fi
attached="$(whim_gcloud compute disks describe "$WHIM_DATA_DISK_NAME" --zone "$zone" --format='json(resourcePolicies)')"
case "$attached" in
  *"/resourcePolicies/$SNAPSHOT_POLICY\""*) echo "unchanged: $SNAPSHOT_POLICY is attached to $WHIM_DATA_DISK_NAME" ;;
  *) whim_gcloud compute disks add-resource-policies "$WHIM_DATA_DISK_NAME" --zone "$zone" --resource-policies "$SNAPSHOT_POLICY" ;;
esac

echo "==> log bucket $LOG_BUCKET in $region (keep $LOG_KEEP_DAYS days), fed by the _Default sink"
if log_keep_days="$(whim_gcloud logging buckets describe "$LOG_BUCKET" --location "$region" \
  --format='value(retentionDays)' 2>/dev/null)"; then
  if [[ "$log_keep_days" = "$LOG_KEEP_DAYS" ]]; then
    echo "unchanged log bucket $LOG_BUCKET"
  else
    whim_gcloud logging buckets update "$LOG_BUCKET" --location "$region" --retention-days "$LOG_KEEP_DAYS"
  fi
else
  whim_gcloud logging buckets create "$LOG_BUCKET" --location "$region" --retention-days "$LOG_KEEP_DAYS" \
    --description "Whim server and VM logs, kept in the region (docs/deploy.md, Logs)"
fi
readonly log_destination="logging.googleapis.com/projects/$project/locations/$region/buckets/$LOG_BUCKET"
if [[ "$(whim_gcloud logging sinks describe _Default --format='value(destination)')" = "$log_destination" ]]; then
  echo "unchanged: _Default sink writes to $LOG_BUCKET"
else
  whim_gcloud logging sinks update _Default "$log_destination"
fi
# The global _Default bucket gets nothing new; keep what it already holds for the shortest time allowed.
[[ "$(whim_gcloud logging buckets describe _Default --location global --format='value(retentionDays)')" = 1 ]] \
  || whim_gcloud logging buckets update _Default --location global --retention-days 1

echo "==> vm $WHIM_VM_NAME"
if [ "$vm_exists" -eq 1 ]; then
  echo "exists on $(whim_vm_machine_type); deploy/resize.sh changes its machine type"
else
  whim_gcloud compute instances create "$WHIM_VM_NAME" --zone "$zone" --machine-type "$machine_type" \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 20GB --boot-disk-type pd-balanced \
    --disk "name=$WHIM_DATA_DISK_NAME,device-name=$WHIM_DATA_DISK_NAME,mode=rw,auto-delete=no" \
    --network "$WHIM_NETWORK_NAME" --subnet "$WHIM_SUBNET_NAME" --address "$address_name" \
    --service-account "$vm_service_account" --scopes cloud-platform --tags whim-vm \
    --metadata enable-oslogin=TRUE --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --deletion-protection
fi

echo "==> secret $WHIM_OPENROUTER_SECRET_ID (empty)"
exists whim_gcloud secrets describe "$WHIM_OPENROUTER_SECRET_ID" \
  || whim_gcloud secrets create "$WHIM_OPENROUTER_SECRET_ID" --replication-policy user-managed --locations "$region"

echo "==> source-map bucket $SOURCEMAP_BUCKET (private)"
exists whim_gcloud storage buckets describe "$SOURCEMAP_BUCKET" \
  || whim_gcloud storage buckets create "$SOURCEMAP_BUCKET" --location "$region" --uniform-bucket-level-access \
    --public-access-prevention

WHIM_MONITORING_WORK="$work"
whim_apply_monitoring "$WHIM_ALERT_EMAIL" "$WHIM_API_HOST"
readonly channel="$WHIM_MONITORING_CHANNEL"

echo "==> billing budget '$BUDGET_DISPLAY_NAME' on $WHIM_BILLING_ACCOUNT"
# Cloud Billing refuses a budget in any currency but the account's own, so the amount takes it.
currency="$(whim_gcloud beta billing accounts describe "$WHIM_BILLING_ACCOUNT" --format='value(currencyCode)')" \
  || whim_fail "cannot read the currency of billing account $WHIM_BILLING_ACCOUNT (gcloud beta billing accounts describe failed)"
[[ "$currency" =~ ^[A-Z]{3}$ ]] \
  || whim_fail "billing account $WHIM_BILLING_ACCOUNT reports no currency code (got '$currency'); no budget was created or changed"
# Emails the channel (and the billing account's admins) at 50, 90 and 100 % of the month's amount.
budget_settings=(--budget-amount "${WHIM_MONTHLY_BUDGET}${currency}" --filter-projects "projects/$project"
  --notifications-rule-monitoring-notification-channels "$channel")
whim_find_row "$BUDGET_DISPLAY_NAME" "$(whim_gcloud billing budgets list --billing-account "$WHIM_BILLING_ACCOUNT" \
  --format='value(displayName,name,amount.specifiedAmount.units,notificationsRule.monitoringNotificationChannels)')"
if [[ -z "$ROW_NAME" ]]; then
  whim_gcloud billing budgets create --billing-account "$WHIM_BILLING_ACCOUNT" --display-name "$BUDGET_DISPLAY_NAME" \
    "${budget_settings[@]}" --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 >/dev/null
  echo "created budget '$BUDGET_DISPLAY_NAME'"
elif [[ "$ROW_SPEC" != "$WHIM_MONTHLY_BUDGET" ]] || [[ "$ROW_EXTRA" != "$channel" ]]; then
  whim_gcloud billing budgets update "$ROW_NAME" --billing-account "$WHIM_BILLING_ACCOUNT" "${budget_settings[@]}" \
    --clear-threshold-rules --add-threshold-rule percent=0.5 --add-threshold-rule percent=0.9 \
    --add-threshold-rule percent=1.0 >/dev/null
  echo "updated budget '$BUDGET_DISPLAY_NAME'"
else
  echo "unchanged budget '$BUDGET_DISPLAY_NAME'"
fi

cat <<NEXT
provision.sh: done. Next:
  1. Bootstrap the VM:
     gcloud --project $project compute scp --zone $zone --tunnel-through-iap --recurse deploy/vm $WHIM_VM_NAME:/tmp/whim-vm
     gcloud --project $project compute ssh $WHIM_VM_NAME --zone $zone --tunnel-through-iap --command 'sudo bash /tmp/whim-vm/bootstrap.sh --region $region'
  2. The owner adds the OpenRouter key as a version of secret $WHIM_OPENROUTER_SECRET_ID.
  3. deploy/deploy.sh --site-only (pages), then deploy/deploy.sh once the key exists.
NEXT
