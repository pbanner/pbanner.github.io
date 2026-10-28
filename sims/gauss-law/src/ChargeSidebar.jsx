import { CHARGE_TYPES } from './chargeTypes.js';
import ChargeIcon from './ChargeIcon.jsx';

// One icon in the sidebar's column. Reports its own hover in and out (as
// { label, rect } / null) rather than rendering a label itself -- the label
// floats *outside* the thin sidebar, so App.jsx renders it. Same pattern as
// the optics lab's SidebarIconButton.
function SidebarIconButton({ label, active, ariaLabel, dataRole, onPointerDown, onClick, onHoverButton, children }) {
  return (
    <button
      type="button"
      className={`sidebar-icon-button ${active ? 'active' : ''}`}
      aria-label={ariaLabel}
      data-role={dataRole}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onMouseEnter={(e) => onHoverButton({ label, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={() => onHoverButton(null)}
    >
      {children}
    </button>
  );
}

// Left-edge overlay toolbar, styled after the optics lab's: a thin column
// of icons. Each charge icon starts App.jsx's click-vs-drag gesture on
// pointerdown (onButtonPointerDown) -- a plain click arms click-to-place,
// a real drag drops the charge wherever the pointer is released.
export default function ChargeSidebar({ armedTypeId, onButtonPointerDown, onHoverButton }) {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-heading">Add</div>
      <div className="sidebar-column">
        {CHARGE_TYPES.map((type) => (
          <SidebarIconButton
            key={type.id}
            label={type.label}
            active={armedTypeId === type.id}
            ariaLabel={`Add ${type.label}`}
            onPointerDown={(e) => onButtonPointerDown(type.id, e)}
            onHoverButton={onHoverButton}
          >
            <ChargeIcon type={type} />
          </SidebarIconButton>
        ))}
      </div>
    </div>
  );
}
