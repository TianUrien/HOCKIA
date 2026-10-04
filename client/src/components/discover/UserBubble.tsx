/**
 * The member's question in Hockia AI (Figma 44:321, D5.2 398:291): a solid
 * brand-primary bubble on the right, radius 16 with a small tail corner.
 */
export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] rounded-[16px] rounded-br-[4px] bg-hockia-primary px-4 py-2.5 text-white"
        data-testid="ai-user-bubble"
      >
        <p className="text-row whitespace-pre-line">{text}</p>
      </div>
    </div>
  )
}
