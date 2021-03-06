export enum NodeChange {
  Value = 1,
  Valid = 2,
  Touched = 4,
  Disabled = 8,
  Error = 16,
  Dirty = 32,
  All = Value | Valid | Touched | Disabled | Error | Dirty,
  Validate = 64,
}

export type ChangeListener<C extends BaseControl> = [
  NodeChange,
  (control: C, cb: NodeChange) => void
];

let nodeCount = 0;

export abstract class BaseControl {
  valid: boolean = true;
  error: string | undefined | null;
  touched: boolean = false;
  disabled: boolean = false;
  dirty: boolean = false;
  uniqueId = ++nodeCount;
  element: HTMLElement | null = null;

  /**
   * @internal
   */
  listeners: ChangeListener<any>[] = [];
  stateVersion: number = 0;
  /**
   * @internal
   */
  freezeCount: number = 0;
  /**
   * @internal
   */
  frozenChanges: NodeChange = 0;

  /**
   * @internal
   */
  abstract visitChildren(
    visit: (c: BaseControl) => boolean,
    doSelf?: boolean,
    recurse?: boolean
  ): boolean;

  abstract setTouched(showValidation: boolean): void;

  /**
   * @internal
   */
  updateError(error?: string | null): NodeChange {
    if (this.error !== error) {
      this.error = error;
      return NodeChange.Error | this.updateValid(!Boolean(error));
    }
    return this.updateValid(!Boolean(error));
  }

  /**
   * @internal
   */
  updateValid(valid: boolean): NodeChange {
    if (this.valid !== valid) {
      this.valid = valid;
      return NodeChange.Valid;
    }
    return 0;
  }

  /**
   * @internal
   */
  updateDisabled(disabled: boolean): NodeChange {
    if (this.disabled !== disabled) {
      this.disabled = disabled;
      return NodeChange.Disabled;
    }
    return 0;
  }

  /**
   * @internal
   */
  updateDirty(dirty: boolean): NodeChange {
    if (this.dirty !== dirty) {
      this.dirty = dirty;
      return NodeChange.Dirty;
    }
    return 0;
  }

  /**
   * @internal
   */
  updateTouched(touched: boolean): NodeChange {
    if (this.touched !== touched) {
      this.touched = touched;
      return NodeChange.Touched;
    }
    return 0;
  }

  /**
   * @internal
   */
  private runListeners(changed: NodeChange) {
    this.frozenChanges = 0;
    this.stateVersion++;
    this.listeners.forEach(([m, cb]) => {
      if ((m & changed) !== 0) cb(this, changed);
    });
  }

  /**
   * @internal
   */
  runChange(changed: NodeChange) {
    if (changed) {
      if (this.freezeCount === 0) {
        this.runListeners(changed);
      } else {
        this.frozenChanges |= changed;
      }
    }
  }

  /**
   * @internal
   */
  protected groupedChanges(run: () => void) {
    this.freezeCount++;
    run();
    this.freezeCount--;
    if (this.freezeCount === 0 && this.frozenChanges) {
      this.runListeners(this.frozenChanges);
    }
  }

  addChangeListener(
    listener: (node: this, change: NodeChange) => void,
    mask?: NodeChange
  ) {
    this.listeners = [
      ...this.listeners,
      [mask ? mask : NodeChange.All, listener],
    ];
  }

  removeChangeListener(listener: (node: this, change: NodeChange) => void) {
    this.listeners = this.listeners.filter((cl) => cl[1] !== listener);
  }

  setError(error?: string | null) {
    this.runChange(this.updateError(error));
  }
}

function setValueUnsafe(ctrl: BaseControl, v: any, initial?: boolean) {
  (ctrl as any).setValue(v, initial);
}

function toValueUnsafe(ctrl: BaseControl): any {
  return ctrl instanceof FormControl
    ? ctrl.value
    : ctrl instanceof ArrayControl
    ? ctrl.toArray()
    : ctrl instanceof GroupControl
    ? ctrl.toObject()
    : undefined;
}

type IsOptionalField<K, C> = C extends FormControl<infer V>
  ? undefined extends V
    ? K
    : never
  : never;

type IsRequiredField<K, C> = C extends FormControl<infer V>
  ? undefined extends V
    ? never
    : K
  : K;

export type ControlValue<C> = C extends GroupControl<infer F>
  ? { [K in keyof F as IsRequiredField<K, F[K]>]: ControlValue<F[K]> } &
      { [K in keyof F as IsOptionalField<K, F[K]>]?: ControlValue<F[K]> }
  : C extends FormControl<infer V>
  ? V
  : C extends ArrayControl<infer AC>
  ? ControlValue<AC>[]
  : never;

export type ControlValueOut<C> = C extends GroupControl<infer F>
  ? { [K in keyof F]: ControlValueOut<F[K]> }
  : C extends FormControl<infer V>
  ? V
  : C extends ArrayControl<infer AC>
  ? ControlValueOut<AC>[]
  : never;

export class FormControl<V> extends BaseControl {
  initialValue: V;

  constructor(
    public value: V,
    validator?: ((v: V) => string | undefined | null) | null
  ) {
    super();
    this.initialValue = value;
    if (validator !== null) {
      this.addChangeListener(() => {
        const error = validator?.(this.value);
        this.runChange(this.updateError(error));
      }, NodeChange.Value | NodeChange.Validate);
    }
  }

  /**
   * Set the value for this control and
   * update the dirty flag if changed.
   * @param value The value to set
   * @param initial If true the dirty flag is reset
   * and a copy of the value is kept to check for dirtiness
   * on any future updates.
   */
  setValue(value: V, initial?: boolean): void {
    if (value !== this.value) {
      this.value = value;
      if (initial) {
        this.initialValue = value;
      }
      this.runChange(
        NodeChange.Value | this.updateDirty(value !== this.initialValue)
      );
    } else if (initial) {
      this.initialValue = value;
      this.runChange(this.updateDirty(false));
    }
  }

  visitChildren(
    visit: (c: BaseControl) => boolean,
    doSelf?: boolean,
    recurse?: boolean
  ): boolean {
    return !doSelf || visit(this);
  }

  /**
   * Set the disabled flag.
   * @param disabled
   */
  setDisabled(disabled: boolean) {
    this.runChange(this.updateDisabled(disabled));
  }

  /**
   * Set the touched flag.
   * @param touched
   */
  setTouched(touched: boolean) {
    this.runChange(this.updateTouched(touched));
  }

  /**
   * Run validation listeners.
   */
  validate() {
    this.runChange(NodeChange.Validate);
  }
}

export abstract class ParentControl extends BaseControl {
  /**
   * @internal
   */
  protected updateAll(change: (c: BaseControl) => NodeChange) {
    this.visitChildren(
      (c) => {
        c.runChange(change(c));
        return true;
      },
      true,
      true
    );
  }

  /**
   * @internal
   */
  protected parentListener(): ChangeListener<BaseControl> {
    return [
      NodeChange.Value |
        NodeChange.Valid |
        NodeChange.Touched |
        NodeChange.Dirty,
      (child, change) => {
        var flags: NodeChange = change & NodeChange.Value;
        if (change & NodeChange.Valid) {
          const valid =
            child.valid && (this.valid || this.visitChildren((c) => c.valid));
          flags |= this.updateValid(valid);
        }
        if (change & NodeChange.Dirty) {
          const dirty =
            child.dirty || (this.dirty && !this.visitChildren((c) => !c.dirty));
          flags |= this.updateDirty(dirty);
        }
        if (change & NodeChange.Touched) {
          flags |= this.updateTouched(child.touched || this.touched);
        }
        this.runChange(flags);
      },
    ];
  }

  /**
   * @internal
   */
  protected controlFromDef(cdef: any, value: any): BaseControl {
    const l = this.parentListener();
    var child = cdef.createControl
      ? cdef.createControl(value)
      : cdef.createArray
      ? cdef.createArray(value)
      : cdef.createGroup(value);
    child.addChangeListener(l[1], l[0]);
    return child;
  }

  /**
   * Set the disabled flag on this and all children.
   * @param disabled
   */
  setDisabled(disabled: boolean) {
    this.updateAll((c) => c.updateDisabled(disabled));
  }

  /**
   * Set the touched flag on this and any children.
   * @param touched
   */
  setTouched(touched: boolean) {
    this.updateAll((c) => c.updateTouched(touched));
  }

  /**
   * Run validation listeners for this and any children.
   */
  validate() {
    this.updateAll(() => NodeChange.Validate);
  }

  /**
   * Clear all error messages and mark controls as valid.
   */
  clearErrors() {
    this.updateAll((c) => c.updateError(undefined));
  }

  /**
   * Lookup a child control give an array of control path elements.
   * A path element is either a string property name for GroupControl
   * or an index number for ArrayControl.
   * @param path
   */
  lookupControl(path: (string | number)[]): BaseControl | null {
    var base = this;
    var index = 0;
    while (index < path.length && base) {
      const childId = path[index];
      if (base instanceof GroupControl) {
        base = base.fields[childId];
      } else if (base instanceof ArrayControl && typeof childId == "number") {
        base = base.elems[childId];
      } else {
        return null;
      }
      index++;
    }
    return base;
  }
}

export type FormFields<R> = { [K in keyof R]-?: FormControl<R[K]> };

export type GroupControlFields<R> = GroupControl<FormFields<R>>;

export class ArrayControl<FIELD extends BaseControl> extends ParentControl {
  elems: FIELD[] = [];
  initialFields: FIELD[] = [];

  constructor(private childDefinition: any) {
    super();
  }

  /**
   * Set the child values. Underlying nodes will be
   * added/deleted if the size of the array changes.
   * @param value The values to set on child nodes
   * @param initial If true reset the dirty flag
   */
  setValue(value: ControlValue<FIELD>[], initial?: boolean): void {
    this.groupedChanges(() => {
      var flags: NodeChange = 0;
      const childElems = [...this.elems];
      if (childElems.length !== value.length) {
        flags |= NodeChange.Value;
      }
      value.map((v, i) => {
        if (childElems.length <= i) {
          const newControl = this.controlFromDef(this.childDefinition, v);
          childElems.push(newControl as FIELD);
        } else {
          setValueUnsafe(childElems[i], v, initial);
        }
      });
      const targetLength = value.length;
      const actualLength = childElems.length;
      if (targetLength !== actualLength) {
        childElems.splice(targetLength, actualLength - targetLength);
      }
      this.elems = childElems;
      if (initial) {
        this.initialFields = childElems;
        flags |= this.updateDirty(false);
      }
      this.runChange(flags);
    });
  }

  toArray(): ControlValueOut<FIELD>[] {
    return this.elems.map((e) => toValueUnsafe(e));
  }

  visitChildren(
    visit: (c: BaseControl) => boolean,
    doSelf?: boolean,
    recurse?: boolean
  ): boolean {
    if (doSelf && !visit(this)) {
      return false;
    }
    if (!this.elems.every(visit)) {
      return false;
    }
    if (recurse) {
      return this.elems.every((c) => c.visitChildren(visit, false, true));
    }
    return true;
  }

  /**
   * Add a new element to the array
   * @param value The value for the child control
   */
  addFormElement(value: ControlValue<FIELD>, index?: number): FIELD {
    const newCtrl = this.controlFromDef(this.childDefinition, value) as FIELD;
    this.elems = [...this.elems];
    if (index !== undefined) {
      this.elems.splice(index, 0, newCtrl);
    } else {
      this.elems.push(newCtrl);
    }
    this.runChange(NodeChange.Value | this.updateArrayFlags());
    return newCtrl;
  }

  /**
   * Update the form elements and check flags.
   * @param f A function which takes the array of form elements and a function which
   * can create new elements and returns a new array.
   */
  updateFormElements(
    f: (
      fields: FIELD[],
      makeChild: (value: ControlValue<FIELD>) => FIELD
    ) => FIELD[]
  ): void {
    const newElems = f(
      this.elems,
      (v) => this.controlFromDef(this.childDefinition, v) as FIELD
    );
    if (this.elems !== newElems) {
      this.elems = newElems;
      this.runChange(NodeChange.Value | this.updateArrayFlags());
    }
  }

  /**
   * Remove an element in the array by index
   * @param index The index of the form element to remove
   */
  removeFormElement(index: number): void {
    this.elems = this.elems.filter((e, i) => i !== index);
    this.runChange(NodeChange.Value | this.updateArrayFlags());
  }

  private shallowEquals<A>(a: A[], b: A[]) {
    if (a.length !== b.length) {
      return false;
    }
    return !a.some((v, i) => v !== b[i]);
  }

  private updateArrayFlags() {
    return (
      this.updateTouched(true) |
      this.updateDirty(
        !this.shallowEquals(this.elems, this.initialFields) ||
          !this.visitChildren((c) => !c.dirty)
      )
    );
  }
}

export class GroupControl<
  FIELDS extends { [k: string]: BaseControl }
> extends ParentControl {
  fields: FIELDS;

  constructor(children: FIELDS, v: GroupValues<FIELDS>) {
    super();
    const fields: Record<string, BaseControl> = {};
    const rec = v as Record<string, any>;
    for (const k in children) {
      const cdef = children[k];
      const value = rec[k];
      fields[k] = this.controlFromDef(cdef, value);
    }
    this.fields = (fields as unknown) as FIELDS;
  }

  visitChildren(
    visit: (c: BaseControl) => boolean,
    doSelf?: boolean,
    recurse?: boolean
  ): boolean {
    if (doSelf && !visit(this)) {
      return false;
    }
    const fields = this.fields;
    for (const k in fields) {
      if (!visit(fields[k])) {
        return false;
      }
      if (recurse && !fields[k].visitChildren(visit, false, true)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Set the value of all child nodes.
   * If the child type contains `undefined` the fields is optional.
   * @param value The value for all child nodes
   * @param initial If true reset the dirty flag
   */
  setValue(value: ControlValue<this>, initial?: boolean): void {
    this.groupedChanges(() => {
      const fields = this.fields;
      for (const k in fields) {
        setValueUnsafe(fields[k], (value as any)[k], initial);
      }
    });
  }

  toObject(): ControlValueOut<this> {
    const rec: Record<string, any> = {};
    for (const k in this.fields) {
      const bctrl = this.fields[k];
      rec[k] = toValueUnsafe(bctrl);
    }
    return rec as any;
  }
}

export type FormDataType<DEF> = ControlValue<ControlType<DEF>>;

export type ControlType<T> = T extends ControlDef<infer V>
  ? FormControl<V>
  : T extends ArrayDef<infer E>
  ? ArrayControl<ControlType<E>>
  : T extends GroupDef<infer F>
  ? GroupControl<
      {
        [K in keyof F]: ControlType<F[K]>;
      }
    >
  : never;

export interface ControlDef<V> {
  createControl: (V: V) => FormControl<V>;
}

export interface ArrayDef<ELEM> {
  createArray: (
    v: ControlValue<ControlType<ELEM>>[]
  ) => ArrayControl<ControlType<ELEM>>;
}

export type GroupControls<DEF> = {
  [K in keyof DEF]: ControlType<DEF[K]>;
};

export type GroupValues<DEF extends object> = ControlValue<
  GroupControl<GroupControls<DEF>>
>;

export interface GroupDef<FIELDS extends object> {
  createGroup(value: GroupValues<FIELDS>): GroupControl<GroupControls<FIELDS>>;
}

export type AllowedDef<V> =
  | (V extends (infer X)[]
      ? ArrayDef<AllowedDef<X>>
      : V extends object
      ? GroupDef<{ [K in keyof V]-?: AllowedDef<V[K]> }>
      : never)
  | ControlDef<V>;

/**
 * Define a leaf node containing values of type V
 * @param validator An optional synchronous validator
 */
export function control<V>(
  validator?: ((v: V) => string | undefined) | null
): ControlDef<V> {
  return {
    createControl: (value: V) => new FormControl<V>(value, validator),
  };
}

export function formArray<CHILD>(child: CHILD): ArrayDef<CHILD> {
  return {
    createArray: (value: any) => {
      const arrayCtrl = new ArrayControl<any>(child);
      arrayCtrl.setValue(value, true);
      return arrayCtrl;
    },
  };
}

/**
 *
 * @param children
 */
export function formGroup<DEF extends object>(children: DEF): GroupDef<DEF> {
  return {
    createGroup: (v: GroupValues<DEF>) => new GroupControl<any>(children, v),
  };
}

/**
 * Create a form group function which only accepts
 * valid definitions that will produce values of given type T.
 */
export function buildGroup<T>(): <
  DEF extends { [K in keyof T]-?: AllowedDef<T[K]> }
>(
  children: DEF
) => GroupDef<DEF> {
  return formGroup;
}
