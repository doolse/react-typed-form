import React, {
  ReactElement,
  FC,
  useRef,
  useMemo,
  useState,
  useEffect,
  ReactNode,
} from "react";
import {
  BaseControl,
  NodeChange,
  FormControl,
  ArrayControl,
  GroupControl,
  GroupControls,
  GroupValues,
  GroupDef,
} from "./nodes";

export function useFormListener<C extends BaseControl, S>(
  control: C,
  toState: (state: C) => S,
  mask?: NodeChange
): S {
  const [state, setState] = useState(() => toState(control));
  useEffect(() => {
    setState(toState(control));
  }, [control]);
  useChangeListener(control, (control) => setState(toState(control)), mask);
  return state;
}

/**
 * Create a group control using the given definition.
 * Please note that once created, it will already return the same instance,
 * e.g. the definition should be constant.
 * @param group The definition of the form group
 * @param value The initial value for the form
 * @param dontValidate Whether to run validation on initial values
 */
export function useFormState<FIELDS extends object>(
  group: GroupDef<FIELDS>,
  value: GroupValues<FIELDS>,
  dontValidate?: boolean
): GroupControl<GroupControls<FIELDS>> {
  const ref = useRef<GroupControl<GroupControls<FIELDS>> | undefined>();
  if (!ref.current) {
    const groupState = group.createGroup(value);
    if (!dontValidate) {
      groupState.validate();
    }
    ref.current = groupState;
  }
  return ref.current!;
}

export function useFormListenerComponent<S, C extends BaseControl>(
  control: C,
  toState: (state: C) => S,
  mask?: NodeChange
): FC<{ children: (formState: S) => ReactElement }> {
  return useMemo(
    () => ({ children }) => {
      const state = useFormListener(control, toState, mask);
      return children(state);
    },
    []
  );
}

export interface FormValidAndDirtyProps {
  state: BaseControl;
  children: (validForm: boolean) => ReactElement;
}

export function FormValidAndDirty({ state, children }: FormValidAndDirtyProps) {
  const validForm = useFormListener(
    state,
    (c) => c.valid && c.dirty,
    NodeChange.Valid | NodeChange.Dirty
  );
  return children(validForm);
}

export interface FormArrayProps<C extends BaseControl> {
  state: ArrayControl<C>;
  children: (elems: C[]) => ReactNode;
}

export function FormArray<C extends BaseControl>({
  state,
  children,
}: FormArrayProps<C>) {
  useFormListener(state, (c) => c.elems, NodeChange.Value);
  return <>{children(state.elems)}</>;
}

export function useChangeListener<Node extends BaseControl>(
  control: Node,
  listener: (node: Node, change: NodeChange) => void,
  mask?: NodeChange,
  deps?: any[]
) {
  const updater = useMemo(() => listener, deps ?? [control]);
  useEffect(() => {
    control.addChangeListener(updater, mask);
    return () => control.removeChangeListener(updater);
  }, [updater]);
}

export function useFormStateVersion(control: BaseControl, mask?: NodeChange) {
  return useFormListener(control, (c) => c.stateVersion, mask);
}

function defaultValidCheck(n: BaseControl) {
  return n instanceof FormControl ? n.value : n.stateVersion;
}

export function useAsyncValidator<C extends BaseControl>(
  node: C,
  validator: (
    node: C,
    abortSignal: AbortSignal
  ) => Promise<string | null | undefined>,
  delay: number,
  validCheckValue?: (node: C) => any
) {
  const handler = useRef<number>();
  const abortController = useRef<AbortController>();
  const validCheck = validCheckValue ?? defaultValidCheck;
  useChangeListener(
    node,
    (n) => {
      if (handler.current) {
        window.clearTimeout(handler.current);
      }
      if (abortController.current) {
        abortController.current.abort();
      }
      let currentVersion = validCheck(n);
      handler.current = window.setTimeout(() => {
        const aborter = new AbortController();
        abortController.current = aborter;
        validator(n, aborter.signal)
          .then((error) => {
            if (validCheck(n) === currentVersion) {
              n.setTouched(true);
              n.setError(error);
            }
          })
          .catch((e) => {
            if (
              !(e instanceof DOMException && e.code == DOMException.ABORT_ERR)
            ) {
              throw e;
            }
          });
      }, delay);
    },
    NodeChange.Value | NodeChange.Validate
  );
}

// Only allow strings and numbers
export type FinputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  state: FormControl<string | number>;
};

export function Finput({ state, ...others }: FinputProps) {
  // Re-render on value or disabled state change
  useFormStateVersion(state, NodeChange.Value | NodeChange.Disabled);

  // Update the HTML5 custom validity whenever the error message is changed/cleared
  useChangeListener(
    state,
    (s) =>
      (state.element as HTMLInputElement)?.setCustomValidity(state.error ?? ""),
    NodeChange.Error
  );
  return (
    <input
      ref={(r) => {
        state.element = r;
        if (r) r.setCustomValidity(state.error ?? "");
      }}
      value={state.value}
      disabled={state.disabled}
      onChange={(e) => state.setValue(e.currentTarget.value)}
      onBlur={() => state.setTouched(true)}
      {...others}
    />
  );
}

// Only allow strings and numbers
export type FselectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  state: FormControl<string | number>;
};

export function Fselect({ state, children, ...others }: FselectProps) {
  // Re-render on value or disabled state change
  useFormStateVersion(state, NodeChange.Value | NodeChange.Disabled);

  // Update the HTML5 custom validity whenever the error message is changed/cleared
  useChangeListener(
    state,
    (s) =>
      (s.element as HTMLSelectElement)?.setCustomValidity(state.error ?? ""),
    NodeChange.Error
  );
  return (
    <select
      ref={(r) => {
        state.element = r;
        if (r) r.setCustomValidity(state.error ?? "");
      }}
      value={state.value}
      disabled={state.disabled}
      onChange={(e) => state.setValue(e.currentTarget.value)}
      onBlur={() => state.setTouched(true)}
      {...others}
    >
      {children}
    </select>
  );
}
