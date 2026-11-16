import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type SelectHTMLAttributes } from 'react';

type Option = { value: string; label: string; disabled: boolean; index: number };

/** A searchable presentation of a native select, preserving form submission and change events. */
export function Select({ children, onChange, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState('');
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const label = props['aria-label'] ?? 'Choose an option';

  function syncLabel() { setSelected(native.current?.selectedOptions[0]?.textContent ?? 'Choose an option'); }
  useLayoutEffect(syncLabel, [props.value, props.defaultValue, children]);
  useEffect(() => {
    const form = native.current?.form;
    const reset = () => { window.setTimeout(syncLabel, 0); setInvalid(''); setOpen(false); };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, []);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);

  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const menu = popup.current;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upwards = below < 230 && above > below;
    menu.style.width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24) + 'px';
    menu.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - parseFloat(menu.style.width) - 12)) + 'px';
    menu.style.maxHeight = Math.max(120, Math.min(360, upwards ? above : below)) + 'px';
    if (upwards) menu.style.bottom = (window.innerHeight - rect.top + 7) + 'px';
    else menu.style.top = (rect.bottom + 7) + 'px';
    menu.showPopover?.();
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const reposition = (event: Event) => { if (!(event.target instanceof Node) || !menu.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  useEffect(() => { if (open) activeOption.current?.scrollIntoView({ block: 'nearest' }); }, [active, query, open]);

  function show() {
    if (!native.current || native.current.matches(':disabled')) return;
    const entries = Array.from(native.current.options, (option, index) => ({ value: option.value, label: option.text, disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled), index }));
    setOptions(entries); setQuery(''); setActive(Math.max(0, native.current.selectedIndex)); setOpen(true);
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  function choose(option: Option) {
    if (option.disabled || !native.current || native.current.matches(':disabled')) return;
    const current = Array.from(native.current.options).find(value => value.value === option.value);
    if (!current || current.disabled) { close(); return; }
    native.current.selectedIndex = current.index;
    native.current.dispatchEvent(new Event('change', { bubbles: true }));
    syncLabel(); setInvalid(''); close();
  }
  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Enter') { event.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      let next = event.key === 'Home' ? -1 : event.key === 'End' ? filtered.length : active;
      for (let count = 0; count < filtered.length; count++) {
        next = (next + direction + filtered.length) % filtered.length;
        if (!filtered[next].disabled) { setActive(next); break; }
      }
    }
  }

  return <span className="spatial-select">
    <button ref={trigger} id={props.id} type="button" className="select-trigger" disabled={props.disabled}
      aria-label={label + ': ' + selected} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id + '-options' : undefined}
      aria-invalid={!!invalid || props['aria-invalid']} aria-describedby={invalid ? id + '-error' : props['aria-describedby']}
      onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}>
      <span>{selected}</span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    <select {...props} id={undefined} ref={native} className="select-native" tabIndex={-1} aria-hidden="true"
      onChange={event => { syncLabel(); setInvalid(''); onChange?.(event); }}
      onInvalid={event => { event.preventDefault(); setInvalid(event.currentTarget.validationMessage); trigger.current?.focus(); props.onInvalid?.(event); }}>{children}</select>
    {invalid && <span id={id + '-error'} className="select-error" role="alert">{invalid}</span>}
    {open && <div ref={popup} className="select-popover" popover="auto" onToggle={event => { if (event.newState === 'closed') setOpen(false); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false); }}>
      <div className="select-search"><input ref={search} role="combobox" aria-label={'Search ' + label.toLowerCase()} placeholder="Search options…" value={query}
        autoComplete="off" aria-expanded="true" aria-autocomplete="list" aria-controls={id + '-options'} aria-activedescendant={filtered[active] ? id + '-option-' + filtered[active].index : undefined}
        onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keydown} />
        <button type="button" aria-label="Close options" onClick={close}>×</button></div>
      <div id={id + '-options'} role="listbox" aria-label={label} className="select-options">
        {filtered.map((option, index) => <div key={option.index} id={id + '-option-' + option.index} role="option" aria-selected={option.value === native.current?.value} aria-disabled={option.disabled}
          ref={index === active ? activeOption : undefined} className={'select-option' + (active === index ? ' active' : '')}
          onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); choose(option); }}><span>{option.label}</span><span aria-hidden="true">{option.value === native.current?.value ? '✓' : ''}</span></div>)}
        {!filtered.length && <p className="select-empty" role="status">No matching options. Try another search.</p>}
      </div>
      <div className="select-footer">↑ ↓ navigate <span>Enter to select</span></div>
    </div>}
  </span>;
}
