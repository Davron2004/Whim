#!/usr/bin/env bash
# One-time GCP setup for Whim (design D17, D20, D24, D25). Run by the orchestrator, never by a task:
#
#   deploy/provision.sh                    VM on the standard profile's machine type
#   deploy/provision.sh --profile <name>   VM on that profile's machine type
#
# Idempotent: each resource is described first and created only when missing. It adopts the reserved
# static address whose IP is WHIM_STATIC_IP and fails when none exists (it never creates one). It
# creates the OpenRouter secret empty and never adds a version: the owner sets the key.
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
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE WHIM_STATIC_IP
[[ "$WHIM_STATIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || whim_fail "WHIM_STATIC_IP is not an IPv4 address: $WHIM_STATIC_IP"

readonly project="$WHIM_GCP_PROJECT" region="$WHIM_GCP_REGION" zone="$WHIM_GCP_ZONE"
readonly vm_service_account="$WHIM_VM_SERVICE_ACCOUNT_NAME@$project.iam.gserviceaccount.com"
# Google's IAP TCP forwarding range: SSH is reachable only through IAP.
readonly IAP_RANGE=35.235.240.0/20

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
  secretmanager.googleapis.com iap.googleapis.com logging.googleapis.com monitoring.googleapis.com

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

cat <<NEXT
provision.sh: done. Next:
  1. Bootstrap the VM:
     gcloud --project $project compute scp --zone $zone --tunnel-through-iap --recurse deploy/vm $WHIM_VM_NAME:/tmp/whim-vm
     gcloud --project $project compute ssh $WHIM_VM_NAME --zone $zone --tunnel-through-iap --command 'sudo bash /tmp/whim-vm/bootstrap.sh --region $region'
  2. The owner adds the OpenRouter key as a version of secret $WHIM_OPENROUTER_SECRET_ID.
  3. deploy/deploy.sh --site-only (pages), then deploy/deploy.sh once the key exists.
NEXT
