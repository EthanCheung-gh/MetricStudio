import { Button, Input, Select, SelectItem, Switch, Textarea } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'
import {
  isObjectSpec,
  isRecord,
  isSlotString,
  literalText,
  parseLiteralText,
  setPath,
} from '@/utils/traceFields'
import type { LeafSpec, ObjectSpec, SlotSources } from '@/utils/traceFields'

/**
 * Small controls shared by the trace / layout forms.
 *
 * The value model is deliberately the raw manifest value: a slot string
 * (`$x`, `$opt.width`), a JSON literal (number, string, list, boolean) or a
 * nested object. Nothing is normalised on the way in, so a control that is not
 * touched leaves its key byte-identical.
 */

export const FIELD_LABEL = 'text-[10px] uppercase tracking-wide text-muted'

const MONO_INPUT_CLASSES = {
  input: 'font-mono text-[11px]',
  inputWrapper: 'h-7 min-h-7',
}

/** Sentinel item that switches a slot select into literal-entry mode. */
const LITERAL_KEY = '__literal__'

export function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button
      isIconOnly
      size="sm"
      variant="light"
      color="danger"
      className="h-6 w-5 min-w-0 shrink-0"
      aria-label={label}
      onPress={onPress}
    >
      <X className="h-3 w-3" />
    </Button>
  )
}

/**
 * Slot select with an optional literal entry.
 *
 * Slots are the manifest-resolved options; `allowLiteral` is only set where the
 * backend accepts a literal in that position (`x`/`y`/… and style leaves do,
 * `segments` values do not). A hand-written slot the manifest does not offer
 * is kept as an extra item so it stays visible and selectable.
 */
export function SlotValueField({
  label,
  value,
  options,
  allowLiteral = true,
  numeric = false,
  onChange,
}: {
  label: string
  value: unknown
  options: readonly string[]
  allowLiteral?: boolean
  numeric?: boolean
  onChange: (next: unknown) => void
}) {
  const isSlot = isSlotString(value)
  const showLiteral = allowLiteral && !isSlot
  const items = isSlot && !options.includes(value) ? [...options, value] : [...options]
  const selected = isSlot ? value : allowLiteral ? LITERAL_KEY : ''
  const itemKeys = allowLiteral ? [LITERAL_KEY, ...items] : items

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex min-w-0 items-center gap-1">
        <Select
          size="sm"
          aria-label={label}
          placeholder="—"
          selectedKeys={selected === '' ? [] : [selected]}
          onSelectionChange={(keys) => {
            const next = String(Array.from(keys)[0] ?? '')
            if (next === '') return
            if (next === LITERAL_KEY) {
              // Switching to a literal does not invent a value: the key is
              // cleared and the empty literal input below takes over.
              if (isSlot) onChange(undefined)
              return
            }
            onChange(next)
          }}
          classNames={{ trigger: 'h-7 min-h-7', value: 'font-mono text-[11px]' }}
        >
          {itemKeys.map((option) => (
            <SelectItem
              key={option}
              textValue={option === LITERAL_KEY ? 'literal' : option}
            >
              {option === LITERAL_KEY ? 'literal' : option}
            </SelectItem>
          ))}
        </Select>
        {showLiteral && (
          <Input
            size="sm"
            type={numeric ? 'number' : 'text'}
            aria-label={`${label} literal`}
            value={literalText(value)}
            onValueChange={(text) => onChange(parseLiteralText(text, numeric))}
            classNames={MONO_INPUT_CLASSES}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Compact number input for layout scalars (`margin.l`, `legend.x`, …).
 *
 * The value may still be a `$opt.<key>` slot — typing one turns the control
 * into the slot select on the next render.
 */
export function NumberField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: unknown
  options: readonly string[]
  onChange: (next: unknown) => void
}) {
  if (isSlotString(value)) {
    return (
      <SlotValueField label={label} value={value} options={options} numeric onChange={onChange} />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <Input
        size="sm"
        inputMode="decimal"
        aria-label={label}
        value={literalText(value)}
        onValueChange={(text) => onChange(parseLiteralText(text, true))}
        classNames={MONO_INPUT_CLASSES}
      />
    </div>
  )
}

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex h-7 items-center justify-between gap-1">
      <span className="truncate font-mono text-[11px]">{label}</span>
      <Switch size="sm" isSelected={value === true} onValueChange={onChange} aria-label={label} />
    </div>
  )
}

function SelectField({
  label,
  value,
  choices,
  onChange,
}: {
  label: string
  value: unknown
  choices: readonly string[]
  onChange: (next: string) => void
}) {
  const current = typeof value === 'string' ? value : literalText(value)
  const items = current !== '' && !choices.includes(current) ? [...choices, current] : [...choices]
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <Select
        size="sm"
        aria-label={label}
        placeholder="—"
        selectedKeys={current === '' ? [] : [current]}
        onSelectionChange={(keys) => {
          const next = String(Array.from(keys)[0] ?? '')
          if (next !== '') onChange(next)
        }}
        classNames={{ trigger: 'h-7 min-h-7', value: 'font-mono text-[11px]' }}
      >
        {items.map((choice) => (
          <SelectItem key={choice} textValue={choice}>
            {choice}
          </SelectItem>
        ))}
      </Select>
    </div>
  )
}

/** Exactly-two value list (`gauge.axis.range`, `gauge.steps[].range`). */
function PairField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: unknown
  options: readonly string[]
  onChange: (next: unknown[]) => void
}) {
  const list = Array.isArray(value) ? value : []
  const setAt = (index: number, next: unknown) => {
    const copy: unknown[] = [list[0] ?? '', list[1] ?? '']
    copy[index] = next
    onChange(copy)
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <SlotValueField
          label="[0]"
          value={list[0]}
          options={options}
          onChange={(next) => setAt(0, next)}
        />
        <SlotValueField
          label="[1]"
          value={list[1]}
          options={options}
          onChange={(next) => setAt(1, next)}
        />
      </div>
    </div>
  )
}

/** `gauge.steps`: at most 10 `{range: [lo, hi], color}` objects. */
export function GaugeStepsField({
  label,
  value,
  sources,
  onChange,
}: {
  label: string
  value: unknown
  sources: SlotSources
  onChange: (next: unknown[]) => void
}) {
  const steps = Array.isArray(value) ? value.filter(isRecord) : []
  const replace = (index: number, next: Record<string, unknown>) =>
    onChange(steps.map((step, i) => (i === index ? next : step)))
  return (
    <div className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      {steps.map((step, index) => {
        const range = Array.isArray(step.range) ? step.range : []
        const setRange = (item: number, next: unknown) => {
          const copy: unknown[] = [range[0] ?? '', range[1] ?? '']
          copy[item] = next
          replace(index, { ...step, range: copy })
        }
        return (
          <div key={index} className="flex items-end gap-1">
            <span className="w-4 shrink-0 pb-1.5 text-[10px] text-muted">{index + 1}</span>
            <SlotValueField
              label="range[0]"
              value={range[0]}
              options={sources.options}
              onChange={(next) => setRange(0, next)}
            />
            <SlotValueField
              label="range[1]"
              value={range[1]}
              options={sources.options}
              onChange={(next) => setRange(1, next)}
            />
            <SlotValueField
              label="color"
              value={step.color}
              options={sources.options}
              onChange={(next) => replace(index, setPath(step, 'color', next))}
            />
            <RemoveButton
              label={`remove step ${index + 1}`}
              onPress={() => onChange(steps.filter((_, i) => i !== index))}
            />
          </div>
        )
      })}
      <Button
        size="sm"
        variant="flat"
        className="text-[11px]"
        startContent={<Plus className="h-3 w-3" />}
        isDisabled={steps.length >= 10}
        onPress={() => onChange([...steps, { range: [0, 0] }])}
      >
        {label}
      </Button>
    </div>
  )
}

/**
 * One schema leaf. `data` / `dataOnly` / `text` / `style` / `arrayStyle` all
 * render the same slot-or-literal control with a different option family.
 */
export function LeafField({
  spec,
  value,
  sources,
  onChange,
}: {
  spec: LeafSpec
  value: unknown
  sources: SlotSources
  onChange: (next: unknown) => void
}) {
  switch (spec.control) {
    case 'boolean':
      if (isSlotString(value)) {
        return (
          <SlotValueField
            label={spec.key}
            value={value}
            options={sources.options}
            onChange={onChange}
          />
        )
      }
      return <BooleanField label={spec.key} value={value} onChange={onChange} />
    case 'select':
      return (
        <SelectField
          label={spec.key}
          value={value}
          choices={spec.choices ?? []}
          onChange={onChange}
        />
      )
    case 'pair':
      return (
        <PairField label={spec.key} value={value} options={sources.options} onChange={onChange} />
      )
    case 'list':
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={FIELD_LABEL}>{spec.key}</span>
          <Input
            size="sm"
            aria-label={spec.key}
            value={literalText(value)}
            onValueChange={(text) => onChange(parseLiteralText(text, false))}
            classNames={MONO_INPUT_CLASSES}
          />
        </div>
      )
    case 'steps':
      return (
        <GaugeStepsField
          label={spec.key}
          value={value}
          sources={sources}
          onChange={onChange}
        />
      )
    case 'data':
      return (
        <SlotValueField
          label={spec.key}
          value={value}
          options={sources.data}
          onChange={onChange}
        />
      )
    case 'dataOnly':
      return (
        <SlotValueField
          label={spec.key}
          value={value}
          options={sources.data}
          allowLiteral={false}
          onChange={onChange}
        />
      )
    case 'text':
      return (
        <SlotValueField
          label={spec.key}
          value={value}
          options={spec.slots === 'label' ? [...sources.labels, ...sources.options] : sources.options}
          onChange={onChange}
        />
      )
    case 'arrayStyle':
      return (
        <SlotValueField
          label={spec.key}
          value={value}
          options={[...sources.array, ...sources.options]}
          onChange={onChange}
        />
      )
    case 'styleNumber':
      return (
        <SlotValueField
          label={spec.key}
          value={value}
          options={sources.options}
          numeric
          onChange={onChange}
        />
      )
    case 'style':
    default:
      return (
        <SlotValueField
          label={spec.key}
          value={value}
          options={sources.options}
          onChange={onChange}
        />
      )
  }
}

function LeafRow({
  spec,
  value,
  sources,
  onChange,
}: {
  spec: LeafSpec
  value: unknown
  sources: SlotSources
  onChange: (next: unknown) => void
}) {
  return (
    <div className="flex items-end gap-1">
      <div className="min-w-0 flex-1">
        <LeafField spec={spec} value={value} sources={sources} onChange={onChange} />
      </div>
      {value !== undefined && (
        <RemoveButton label={`clear ${spec.key}`} onPress={() => onChange(undefined)} />
      )}
    </div>
  )
}

/**
 * One nested style object (`line`, `marker`, `marker.line`, `gauge.axis`, …).
 *
 * Absent objects collapse to an "add" button, so the form only grows the parts
 * the trace actually uses. `onChange(undefined)` removes the object entirely.
 */
export function ObjectSection({
  spec,
  value,
  sources,
  onChange,
}: {
  spec: ObjectSpec
  value: unknown
  sources: SlotSources
  onChange: (next: Record<string, unknown> | undefined) => void
}) {
  if (!isRecord(value)) {
    return (
      <Button
        size="sm"
        variant="flat"
        className="text-[11px]"
        startContent={<Plus className="h-3 w-3" />}
        onPress={() => onChange({})}
      >
        {spec.key}
      </Button>
    )
  }
  return (
    <CollapsibleSection title={spec.key} defaultOpen>
      <div className="flex flex-col gap-1">
        {spec.children.map((child) =>
          isObjectSpec(child) ? (
            <ObjectSection
              key={child.key}
              spec={child}
              value={value[child.key]}
              sources={sources}
              onChange={(next) => onChange(setPath(value, child.key, next))}
            />
          ) : (
            <LeafRow
              key={child.key}
              spec={child}
              value={value[child.key]}
              sources={sources}
              onChange={(next) => onChange(setPath(value, child.key, next))}
            />
          ),
        )}
        <Button
          size="sm"
          variant="light"
          color="danger"
          className="w-full text-[11px]"
          onPress={() => onChange(undefined)}
        >
          × {spec.key}
        </Button>
      </div>
    </CollapsibleSection>
  )
}

/** The "高级（JSON）" editor: the full object, replaced wholesale on save. */
export function JsonTextarea({
  label,
  value,
  error,
  minRows = 4,
  onChange,
}: {
  label: string
  value: string
  error?: string
  minRows?: number
  onChange: (next: string) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Textarea
        size="sm"
        aria-label={label}
        minRows={minRows}
        placeholder="{ }"
        value={value}
        onValueChange={onChange}
        isInvalid={error !== undefined}
        classNames={{ input: 'font-mono text-[11px]' }}
      />
      {error !== undefined && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  )
}

/**
 * Non-blocking notice listing keys the form cannot represent. They stay in the
 * object; this only says where they can be edited.
 */
export function UnsupportedNotice({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] leading-relaxed text-warning break-words">
      {message}
    </div>
  )
}
