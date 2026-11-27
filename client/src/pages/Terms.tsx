import { FileText, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function Terms() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 pt-[calc(env(safe-area-inset-top)+3rem)] pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex min-h-[44px] items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors group"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">Back</span>
        </button>

        {/* Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-hockia-soft">
              <FileText className="h-6 w-6 text-hockia-primary" />
            </div>
            <div>
              <h1 className="mb-2 text-title text-ink-1">Terms & Conditions</h1>
              <p className="text-gray-600">Effective date: November 2026</p>
            </div>
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
          {/* Section 1 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">1. Introduction</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                These Terms & Conditions ("Terms") govern your access to and use of Hockia ("the Platform"), a social networking platform dedicated to the field hockey community. Hockia is available as a website at inhockia.com, a Progressive Web App (PWA), and native mobile applications for iOS and Android.
              </p>
              <p>
                By creating an account or using any part of the Platform, you agree to be bound by these Terms. If you do not agree, you may not use Hockia.
              </p>
              <p>
                Hockia is operated by Cristian Urien, an individual resident in Argentina ("we", "us", "our"). Hockia is a free networking platform. It is not an employer, recruitment agency, sports agent or club, and it does not take part in any agreement between members. For questions about these Terms, contact us at team@inhockia.com.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 2 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">2. Eligibility</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                You must be at least 18 years old to create and use an account on Hockia. Club and brand accounts must be created and run by a person aged 18 or over who is authorised to act for the organisation.
              </p>
              <p>
                We may ask you to confirm your date of birth. If you do not confirm it, or we learn that a member is under 18, we may restrict or freeze the account.
              </p>
              <p>
                By creating an account, you represent and warrant that:
              </p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>You meet the minimum age requirement.</li>
                <li>The information you provide is accurate, complete, and current.</li>
                <li>You have the legal capacity to enter into these Terms.</li>
                <li>Your use of the Platform does not violate any applicable law or regulation.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 3 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">3. Account Registration and Roles</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                To use Hockia, you must create an account using one of the following methods: email and password, Google Sign-In, or Sign In with Apple. During registration, you will select a role that defines your experience on the Platform:
              </p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li><strong>Player:</strong> Individual field hockey players who can create profiles, showcase their career history, connect with others, apply for opportunities, and request references.</li>
                <li><strong>Coach:</strong> Field hockey coaches who can create profiles, post opportunities, connect with players and clubs, and manage applications.</li>
                <li><strong>Club:</strong> Field hockey clubs and organizations that can create club profiles, post opportunities for players and coaches, manage members, and recruit talent.</li>
                <li><strong>Brand:</strong> Companies and brands in the field hockey industry that can create brand profiles, manage product catalogs, publish posts, and recruit brand ambassadors.</li>
                <li><strong>Umpire:</strong> Field hockey officials who can create profiles showing their level, federation, specialization, and officiating languages, and connect with clubs and fellow officials.</li>
              </ul>
              <p>
                You are responsible for maintaining the confidentiality of your account credentials. You must notify us immediately if you suspect unauthorized access to your account.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 4 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">4. User Content and Intellectual Property</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                You retain ownership of all content you create, upload, or share on Hockia, including but not limited to: profile information, photos, videos, career history entries, messages, comments, references, endorsements, opportunity listings, applications, and brand posts ("User Content").
              </p>
              <p>
                By posting User Content on Hockia, you grant us a non-exclusive, worldwide, royalty-free, sublicensable license to use, display, reproduce, and distribute your User Content solely for the purpose of operating and improving the Platform. This license ends when you delete your content or your account, except where your content has been shared with other users (e.g., messages, comments, references).
              </p>
              <p className="font-medium">
                You represent and warrant that:
              </p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>You own or have the necessary rights to post your User Content.</li>
                <li>Your User Content does not infringe any third-party intellectual property rights.</li>
                <li>Your User Content does not contain illegal, offensive, defamatory, or harmful material.</li>
                <li>Your User Content does not contain malware, viruses, or any harmful code.</li>
              </ul>
              <p>
                All Hockia branding, logos, designs, and platform features are the intellectual property of Hockia and may not be used without written permission.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 5 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">5. Platform Features and Acceptable Use</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>Hockia provides the following features, among others:</p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>User profiles with personal information, career history, media galleries, and social links.</li>
                <li>A directory of players, coaches, clubs, and brands from around the world.</li>
                <li>An opportunity board where clubs and coaches can post opportunities and users can apply.</li>
                <li>A messaging system for direct communication between users.</li>
                <li>Friend connections and networking features.</li>
                <li>A reference and endorsement system for professional credibility.</li>
                <li>A community section with questions and discussions.</li>
                <li>Profile comments visible to the profile owner and visitors.</li>
                <li>Push notifications and email notifications for relevant activity.</li>
                <li>Brand profiles, product catalogs, and ambassador programs.</li>
              </ul>
              <p className="font-medium mt-4">You agree not to:</p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>Use the Platform for harassment, bullying, threats, or intimidation.</li>
                <li>Send spam, unsolicited messages, or promotional content to other users.</li>
                <li>Misrepresent your identity, role, qualifications, or affiliations.</li>
                <li>Post false, misleading, or fraudulent opportunity listings.</li>
                <li>Attempt to access, hack, scrape, or reverse-engineer any part of the Platform.</li>
                <li>Use automated tools, bots, or scripts to interact with the Platform.</li>
                <li>Collect or harvest other users' personal data without their consent.</li>
                <li>Upload content that is sexually explicit, violent, or promotes hatred.</li>
                <li>Interfere with the normal operation of the Platform or its infrastructure.</li>
                <li>Create multiple accounts for deceptive or abusive purposes.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 6 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">6. Opportunities and Applications</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                Clubs and coaches may post opportunity listings on the Platform. Players and coaches may apply to these opportunities. Hockia serves as a connection platform and does not act as an employer, agent, or intermediary in any hiring or recruitment process.
              </p>
              <p>
                We do not verify, endorse, or guarantee the accuracy of opportunity listings, the qualifications of applicants, or the legitimacy of any party involved. Users are responsible for conducting their own due diligence before entering into any agreements or arrangements that result from connections made on the Platform.
              </p>
              <p>
                Hockia does not check whether an opportunity, an offer, a club, an organisation or a member is genuine, and does not supervise trials, travel, visas, accommodation, contracts, scholarships, payments or meetings that follow from a connection made on Hockia. Never pay a fee to apply for an opportunity or to be selected. If anyone asks you to, report it to us.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 6A */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">6A. Your Dealings with Other Members</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                Hockia only puts members in contact. Any conversation, agreement, trial, trip, meeting, contract, payment, scholarship or other arrangement between members is solely between those members. Hockia is not a party to it.
              </p>
              <p>
                You are responsible for checking who you are dealing with and for deciding whether to go ahead. You take part in any such arrangement at your own risk.
              </p>
              <p>
                If you have a dispute with another member, you agree to resolve it directly with that member. To the extent the law allows, you release Hockia and its operator from any claim, demand or damage of any kind, known or unknown, that arises from or is connected with such a dispute or with the conduct of another member, on or off the Platform.
              </p>
              <p>
                We may, but do not have to, review reports, remove content or restrict accounts. Doing so does not make us responsible for what members do.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 7 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">7. Communications and Notifications</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                By creating an account, you consent to receive communications from Hockia, including:
              </p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>Transactional emails (account verification, password reset, security alerts).</li>
                <li>Notification emails (new messages, friend requests, opportunity updates, reference requests, profile views).</li>
                <li>Email digests summarizing your recent activity and notifications.</li>
                <li>Push notifications on supported devices and browsers.</li>
                <li>Platform announcements and service updates.</li>
              </ul>
              <p>
                You can manage your notification preferences at any time through the Settings page. You may opt out of non-essential notifications, but transactional and security-related communications are required for account operation.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 8 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">8. Moderation and Enforcement</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                Hockia reserves the right to monitor, review, and remove any User Content that violates these Terms or that we deem inappropriate, at our sole discretion.
              </p>
              <p>
                We may take the following actions without prior notice:
              </p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>Remove or restrict access to User Content.</li>
                <li>Issue warnings to users.</li>
                <li>Temporarily suspend or permanently ban accounts that violate these Terms.</li>
                <li>Report illegal activity to relevant authorities.</li>
              </ul>
              <p>
                Users who have been blocked or banned may not create new accounts to circumvent enforcement actions.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 9 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">9. Child Safety</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                Hockia is committed to the safety and protection of minors. The Platform is for adults. It is not directed at anyone under 18, and we do not knowingly allow anyone under 18 to hold an account.
              </p>
              <p>
                Users must not use the Platform to exploit, harm, or endanger minors in any way. Any content or behavior that involves child sexual abuse or exploitation (CSAE) is strictly prohibited and will result in immediate account termination and reporting to relevant authorities.
              </p>
              <p>
                If you become aware of any content or behavior on the Platform that may endanger a child, please report it immediately to team@inhockia.com.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 10 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">10. Disclaimer of Warranties</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                Hockia is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.
              </p>
              <p>
                We do not warrant that the Platform will be uninterrupted, error-free, secure, or free from viruses or other harmful components. We do not guarantee the accuracy, completeness, or reliability of any content on the Platform, including User Content and opportunity listings.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 11 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">11. Limitation of Liability</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                To the fullest extent permitted by applicable law, Hockia, its operator, affiliates, and contributors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, opportunities, goodwill, or other intangible losses, resulting from:
              </p>
              <ul className="list-disc space-y-3 pl-5 ml-4">
                <li>Your use of or inability to use the Platform.</li>
                <li>Any interactions or arrangements between users.</li>
                <li>Unauthorized access to or alteration of your data.</li>
                <li>Any third-party content or conduct on the Platform.</li>
                <li>Any errors, bugs, or interruptions in service.</li>
              </ul>
              <p>
                To the extent the law allows, the total liability of Hockia and its operator to you for all claims arising from these Terms or the Platform is limited to fifty United States dollars (USD 50). Hockia is free, and this limit reflects that.
              </p>
              <p>
                Nothing in these Terms limits or excludes liability that cannot be limited or excluded by law, including liability for intent or gross negligence, or your rights as a consumer under mandatory law.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 11A */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">11A. Indemnity</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                You agree to defend, indemnify and hold harmless Hockia and its operator from any claim, loss, liability, cost or expense (including reasonable legal fees) made by a third party that arises from your content, your use of the Platform, your dealings with other members, or your breach of these Terms or of the law.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 12 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">12. Account Termination and Deletion</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                You may delete your account at any time through the Settings page. Upon account deletion, we will permanently remove your profile, personal data, messages, applications, media files, career history, and all associated content from our servers. Some data that was shared with other users (e.g., messages already delivered, references provided) may persist in the recipients' accounts.
              </p>
              <p>
                Hockia reserves the right to suspend or terminate your account at any time if you violate these Terms, engage in harmful or illegal behavior, or for any other reason at our discretion. We will make reasonable efforts to notify you of account actions unless prohibited by law.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 13 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">13. Third-Party Services</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                Hockia may contain links to external websites or integrate with third-party services. We are not responsible for the content, privacy practices, or terms of any third-party services. Your use of third-party services is at your own risk and subject to their respective terms and policies.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 14 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">14. Governing Law</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                These Terms are governed by the laws of the Argentine Republic.
              </p>
              <p>
                Before starting any claim, you agree to contact us at team@inhockia.com and try to resolve it in good faith for at least 30 days.
              </p>
              <p>
                Any dispute will be decided by the ordinary courts of the Autonomous City of Buenos Aires, Argentina, unless mandatory consumer law gives you the right to bring it in the courts where you live.
              </p>
              <p>
                Any claim arising from these Terms or the Platform must be brought within one year after the facts that give rise to it, unless the law requires a longer period.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 15 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">15. Changes to These Terms</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>
                We may update these Terms from time to time to reflect changes in our Platform, practices, or legal requirements. When we make material changes, we will notify you through the Platform or via email. For material changes, we will ask you to accept the new Terms in the app before you continue using Hockia, and we keep a record of that acceptance.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 16 */}
          <section>
            <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">16. Contact</h2>
            <div className="max-w-[70ch] space-y-4 text-[16px] leading-[1.6] text-ink-2">
              <p>If you have any questions about these Terms, please contact us at:</p>
              <p className="flex items-center gap-2">
                <span>📧</span>
                <a
                  href="mailto:team@inhockia.com"
                  className="text-brand-text transition-colors hover:opacity-80"
                >
                  team@inhockia.com
                </a>
              </p>
            </div>
          </section>

          {/* Last Updated */}
          <div className="pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">Last updated: November 27, 2026</p>
          </div>
        </div>
      </div>
    </div>
  )
}
