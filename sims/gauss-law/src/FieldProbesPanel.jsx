import { probeReading } from './probes.js';
import { toKilonewtonsPerCoulomb } from './chargeField.js';

const AXIS_NAMES = ['x', 'y', 'z'];

// A field value in kN/C as text: three significant figures (whole numbers
// from 100 up, rather than "1.80e+3"), a true minus sign, and with
// `signed`, a + on a positive one. A component that's zero to within
// rounding -- smaller than a billionth of the field's strength, say from
// two charges' fields canceling exactly -- or one that's really tiny
// reads 0.
function formatField(value, strength, signed = false) {
  const size = Math.abs(value);
  if (size < Math.max(1e-6, 1e-9 * strength)) return '0';
  const digits = size >= 100 ? String(Math.round(size)) : size.toPrecision(3);
  return (value < 0 ? '−' : signed ? '+' : '') + digits;
}

// The Field Probes panel: a table of every probe's reading, |E| and its
// components, in kN/C -- or, where the field has no single value, what the
// probe is on. Clicking a row selects that probe; the selected probe's row
// is highlighted. In the 2D cut's view (`cut`), only the components along
// the cut are shown: the field has none across it.
//
// probes: the probes shown (see probes.js), listed by letter. charges:
// everything placed, whose field they read. selectedId / onSelect(id): the
// selection, as for the scene.
export default function FieldProbesPanel({ probes, charges, selectedId, onSelect, cut = null }) {
  const axes = cut ? [0, 1, 2].filter((k) => k !== cut.axis) : [0, 1, 2];
  const sorted = [...probes].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="overlay-controls probe-readings">
      <div className="panel-header">
        <h3>Field Probes</h3>
        <span className="row-unit">E in kN/C</span>
      </div>
      <table className="probe-table">
        <thead>
          <tr>
            <th>Probe</th>
            <th>|E|</th>
            {axes.map((k) => (
              <th key={k}>E<sub>{AXIS_NAMES[k]}</sub></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((probe) => {
            const { field, undefinedOn } = probeReading(charges, probe.position);
            const e = field && toKilonewtonsPerCoulomb(field);
            const strength = e && Math.hypot(...e);
            return (
              <tr key={probe.id} className={probe.id === selectedId ? 'selected' : ''} onClick={() => onSelect(probe.id)}>
                <td>{probe.label}</td>
                {e ? (
                  <>
                    <td>{formatField(strength, strength)}</td>
                    {axes.map((k) => (
                      <td key={k}>{formatField(e[k], strength, true)}</td>
                    ))}
                  </>
                ) : (
                  <td className="probe-undefined" colSpan={1 + axes.length}>undefined: on {undefinedOn}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
