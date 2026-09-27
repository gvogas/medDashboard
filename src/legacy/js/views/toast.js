// One message at a time at the foot of the screen: toast(text, {undo, label, badge,
// error, ms}) and hideToast(). React draws it now (src/components/toaster.tsx); this
// keeps the legacy callers unchanged.
export { toast, hideToast } from '../../../data/toast.ts';
