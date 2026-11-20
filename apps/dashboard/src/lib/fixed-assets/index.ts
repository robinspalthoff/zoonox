// Public façade for the fixed-assets subsystem.
export {
  createAsset,
  postAcquisition,
  postPeriod,
  disposeAsset,
  deleteAssetIfPlanned,
  type CreateAssetInput,
  type CreateAssetResult,
  type DisposeAssetInput,
} from "./service";
export {
  generatePlan,
  computeMonthlyAmount,
  firstOfMonthUTC,
  type PlanRow,
  type PlanInput,
} from "./plan";
export {
  accountsFor,
  suggestMethod,
  DEFAULT_USEFUL_LIFE_MONTHS,
  GWG_NET_THRESHOLD,
  ASSET_HINT_NET_THRESHOLD,
} from "./rules";
export { runDepreciationTick, type DepreciationTickResult } from "./tick";
