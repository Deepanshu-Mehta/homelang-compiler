import { useState } from 'preact/hooks';
import { DEVICE_TYPES, SENSOR_TYPES } from '../../compiler/index';
import { Card } from '../Card';

const TAP_BUGS: readonly [string, string, string][] = [
  ['Infinite Loop', 'Rule A triggers B, and B triggers A.', 'Tarjan SCC finds it (S317, W407). The runtime stops at depth 16.'],
  ['Contradictory Action', 'Heater and AC fight around one threshold.', 'W411 warns; an oscillation check runs at run time.'],
  ['Repeated Triggering', 'A rule keeps firing while its condition stays true.', 'Prevented by design: rules fire only on a change.'],
  ['Nondeterministic Timing', 'The order of two rules decides the result.', 'Fixed order: priority, then source order. W404 warns.'],
  ['Extended Action', 'Actions take time, like curtains moving.', 'WAIT models the delay.'],
  ['Missing Reversal', 'You assume the light turns itself off.', 'W406 warns: nothing ever turns it off.'],
  ['Secure-Default Bias', 'You assume a lock stays locked.', 'W412 warns on UNLOCK with no presence check.'],
  ['Time-Window Fallacy', 'Two events "at the same time" are misread.', 'Not applicable: HomeLang has no event windows.'],
  ['Priority Conflict', 'Two state rules want one device.', 'PRIORITY decides; W404 warns on a tie.'],
  ['Flipped Triggers', 'Event and state swap roles.', 'WHEN event IF state keeps the roles visible.'],
];

function eventName(event: string): string {
  return event.replace('_', ' ');
}

export function DomainCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card id="domain" badge="★" title="How a smart home thinks"
      intro="A smart home is a loop: sensors report, rules decide, devices act. HomeLang rules are written the way people describe them: IF it is hot THEN turn on the AC.">
      <button class="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide the primer' : 'Read the primer'}
      </button>
      {open && (
        <div class="primer">
          <h3>Devices and sensors</h3>
          <p>A <strong>sensor</strong> only reports what it measures, such as temperature or motion. A <strong>device</strong> can be told what to do, such as an AC or a light. Telling a sensor to turn on is a type error, and the compiler catches it.</p>
          <h3>Events and states</h3>
          <p>A <strong>state</strong> is true for a while: the door is locked. An <strong>event</strong> is one moment: the door locks. <code>IF</code> rules watch states and <code>WHEN</code> rules watch events. <code>AT</code> rules watch the clock.</p>
          <h3>Why rules fire on change</h3>
          <p>If <code>IF TEMPERATURE &gt; 30</code> fired every moment it stayed true, the AC would be switched on thousands of times. So a rule fires only when its condition <em>changes</em> from false to true, and its ELSE fires on the change back. Home Assistant works the same way: a numeric trigger fires when the value crosses the threshold.</p>

          <h3>The device catalogue</h3>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Type</th><th>Actions</th><th>Attributes</th><th>States</th><th>Events</th></tr></thead>
              <tbody>
                {DEVICE_TYPES.map((t) => (
                  <tr key={t.name}>
                    <td><code>{t.name}</code></td>
                    <td>{t.actions.join(', ')}</td>
                    <td>{Object.entries(t.attributes).map(([name, a]) =>
                      a.kind === 'number' ? `${name} ${a.min}–${a.max}` : `${name} {${a.values.join(', ')}}`).join('; ') || '—'}</td>
                    <td>{t.states.join(', ')}</td>
                    <td>{t.events.map(eventName).join(', ')}</td>
                  </tr>
                ))}
                {SENSOR_TYPES.map((t) => (
                  <tr key={t.name}>
                    <td><code>{t.name}</code></td>
                    <td class="muted">read-only</td>
                    <td>—</td>
                    <td>{t.states ? t.states.join(', ') : `numeric ${t.plausible?.[0]}…${t.plausible?.[1]}`}</td>
                    <td>{t.events.map(eventName).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Ten ways automations go wrong</h3>
          <p class="muted">Brackenbury et al. (CHI 2019) catalogued these bugs in trigger-action programs. Here is how HomeLang responds to each.</p>
          <div class="bug-grid">
            {TAP_BUGS.map(([name, meaning, response]) => (
              <article class="bug" key={name}>
                <h4>{name}</h4>
                <p>{meaning}</p>
                <p class="bug-response">{response}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
