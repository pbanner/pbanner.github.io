// A choice among a few options, as a row of joined toggle buttons, the
// chosen one in the selection blue (see .segmented in App.css): a charged
// rod's axis or a plane's orientation in the properties panel, the field's
// style in Display Options. options: [[value, label], ...].
// isDisabled(option) grays out the options that can't be chosen, and
// titleFor(option), if given, is an option's tooltip (say, why it can't be
// chosen).
export default function Segmented({ options, value, onChange, isDisabled = () => false, titleFor = () => undefined }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={v === value ? 'active' : ''} disabled={isDisabled(v)} title={titleFor(v)} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
