import { useEffect as r } from "react";
import { Recap as o } from "./index.js";
function a({ onExport: e, ...t }) {
  return r(() => (o.init(t), () => {
    o.destroy();
  }), []), null;
}
export {
  a as Recap,
  a as RecapComponent,
  a as default
};
