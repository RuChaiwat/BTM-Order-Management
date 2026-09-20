/** Small inline spinner for inside a button while its own action is submitting — e.g.
 * `{submitting && <Spinner />} Confirm`. Use the `dark` variant on a light/outline button. */
export function Spinner({ dark }: { dark?: boolean }) {
  return <span className={`spinner${dark ? ' spinner-dark' : ''}`} style={{ marginRight: 8 }} />
}
