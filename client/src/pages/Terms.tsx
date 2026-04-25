import { FileText, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function Terms() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors group"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">Back</span>
        </button>

        {/* Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms & Conditions</h1>
              <p className="text-gray-600">Effective date: March 2026</p>
            </div>
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
          {/* Section 1 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                These Terms & Conditions ("Terms") govern your access to and use of HOCKIA ("the Platform"), a social networking platform dedicated to the field hockey community. HOCKIA is available as a website at inhockia.com, a Progressive Web App (PWA), and native mobile applications for iOS and Android.
              </p>
              <p>
                By creating an account or using any part of the Platform, you agree to be bound by these Terms. If you do not agree, you may not use HOCKIA.
              </p>
              <p>
                HOCKIA is operated by Cristian Urien ("we", "us", "our"). For questions about these Terms, contact us at team@inhockia.com.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 2 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Eligibility</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                You must be at least 16 years old to create an account on HOCKIA. If you are between 16 and 18 years old, you must have consent from a parent or legal guardian to use the Platform.
              </p>
              <p>
                By creating an account, you represent and warrant that:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>- You meet the minimum age requirement.</li>
                <li>- The information you provide is accurate, complete, and current.</li>
                <li>- You have the legal capacity to enter into these Terms.</li>
                <li>- Your use of the Platform does not violate any applicable law or regulation.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 3 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Account Registration and Roles</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                To use HOCKIA, you must create an account using one of the following methods: email and password, Google Sign-In, or Sign In with Apple. During registration, you will select a role that defines your experience on the Platform:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li><strong>Player:</strong> Individual field hockey players who can create profiles, showcase their career history, connect with others, apply for opportunities, and request references.</li>
                <li><strong>Coach:</strong> Field hockey coaches who can create profiles, post opportunities and vacancies, connect with players and clubs, and manage applications.</li>
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
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. User Content and Intellectual Property</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                You retain ownership of all content you create, upload, or share on HOCKIA, including but not limited to: profile information, photos, videos, career history entries, messages, comments, references, endorsements, opportunity listings, applications, and brand posts ("User Content").
              </p>
              <p>
                By posting User Content on HOCKIA, you grant us a non-exclusive, worldwide, royalty-free, sublicensable license to use, display, reproduce, and distribute your User Content solely for the purpose of operating and improving the Platform. This license ends when you delete your content or your account, except where your content has been shared with other users (e.g., messages, comments, references).
              </p>
              <p className="font-medium">
                You represent and warrant that:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>- You own or have the necessary rights to post your User Content.</li>
                <li>- Your User Content does not infringe any third-party intellectual property rights.</li>
                <li>- Your User Content does not contain illegal, offensive, defamatory, or harmful material.</li>
                <li>- Your User Content does not contain malware, viruses, or any harmful code.</li>
              </ul>
              <p>
                All HOCKIA branding, logos, designs, and platform features are the intellectual property of HOCKIA and may not be used without written permission.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 5 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Platform Features and Acceptable Use</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>HOCKIA provides the following features, among others:</p>
              <ul className="list-none space-y-3 ml-4">
                <li>- User profiles with personal information, career history, media galleries, and social links.</li>
                <li>- A directory of players, coaches, clubs, and brands from around the world.</li>
                <li>- An opportunity board where clubs and coaches can post vacancies and users can apply.</li>
                <li>- A messaging system for direct communication between users.</li>
                <li>- Friend connections and networking features.</li>
                <li>- A reference and endorsement system for professional credibility.</li>
                <li>- A community section with questions and discussions.</li>
                <li>- Profile comments visible to the profile owner and visitors.</li>
                <li>- Push notifications and email notifications for relevant activity.</li>
                <li>- Brand profiles, product catalogs, and ambassador programs.</li>
              </ul>
              <p className="font-medium mt-4">You agree not to:</p>
              <ul className="list-none space-y-3 ml-4">
                <li>- Use the Platform for harassment, bullying, threats, or intimidation.</li>
                <li>- Send spam, unsolicited messages, or promotional content to other users.</li>
                <li>- Misrepresent your identity, role, qualifications, or affiliations.</li>
                <li>- Post false, misleading, or fraudulent opportunity listings.</li>
                <li>- Attempt to access, hack, scrape, or reverse-engineer any part of the Platform.</li>
                <li>- Use automated tools, bots, or scripts to interact with the Platform.</li>
                <li>- Collect or harvest other users' personal data without their consent.</li>
                <li>- Upload content that is sexually explicit, violent, or promotes hatred.</li>
                <li>- Interfere with the normal operation of the Platform or its infrastructure.</li>
                <li>- Create multiple accounts for deceptive or abusive purposes.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 6 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Opportunities and Applications</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                Clubs and coaches may post opportunity listings on the Platform. Players and coaches may apply to these opportunities. HOCKIA serves as a connection platform and does not act as an employer, agent, or intermediary in any hiring or recruitment process.
              </p>
              <p>
                We do not verify, endorse, or guarantee the accuracy of opportunity listings, the qualifications of applicants, or the legitimacy of any party involved. Users are responsible for conducting their own due diligence before entering into any agreements or arrangements that result from connections made on the Platform.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 7 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Communications and Notifications</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                By creating an account, you consent to receive communications from HOCKIA, including:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>- Transactional emails (account verification, password reset, security alerts).</li>
                <li>- Notification emails (new messages, friend requests, opportunity updates, reference requests, profile views).</li>
                <li>- Email digests summarizing your recent activity and notifications.</li>
                <li>- Push notifications on supported devices and browsers.</li>
                <li>- Platform announcements and service updates.</li>
              </ul>
              <p>
                You can manage your notification preferences at any time through the Settings page. You may opt out of non-essential notifications, but transactional and security-related communications are required for account operation.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 8 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Moderation and Enforcement</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA reserves the right to monitor, review, and remove any User Content that violates these Terms or that we deem inappropriate, at our sole discretion.
              </p>
              <p>
                We may take the following actions without prior notice:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>- Remove or restrict access to User Content.</li>
                <li>- Issue warnings to users.</li>
                <li>- Temporarily suspend or permanently ban accounts that violate these Terms.</li>
                <li>- Report illegal activity to relevant authorities.</li>
              </ul>
              <p>
                Users who have been blocked or banned may not create new accounts to circumvent enforcement actions.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 9 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Child Safety</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA is committed to the safety and protection of minors. The Platform is not directed at children under 16, and we do not knowingly collect personal data from children under 16 without parental consent.
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
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Disclaimer of Warranties</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.
              </p>
              <p>
                We do not warrant that the Platform will be uninterrupted, error-free, secure, or free from viruses or other harmful components. We do not guarantee the accuracy, completeness, or reliability of any content on the Platform, including User Content and opportunity listings.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 11 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Limitation of Liability</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                To the fullest extent permitted by applicable law, HOCKIA, its operator, affiliates, and contributors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, opportunities, goodwill, or other intangible losses, resulting from:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>- Your use of or inability to use the Platform.</li>
                <li>- Any interactions or arrangements between users.</li>
                <li>- Unauthorized access to or alteration of your data.</li>
                <li>- Any third-party content or conduct on the Platform.</li>
                <li>- Any errors, bugs, or interruptions in service.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 12 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Account Termination and Deletion</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                You may delete your account at any time through the Settings page. Upon account deletion, we will permanently remove your profile, personal data, messages, applications, media files, career history, and all associated content from our servers. Some data that was shared with other users (e.g., messages already delivered, references provided) may persist in the recipients' accounts.
              </p>
              <p>
                HOCKIA reserves the right to suspend or terminate your account at any time if you violate these Terms, engage in harmful or illegal behavior, or for any other reason at our discretion. We will make reasonable efforts to notify you of account actions unless prohibited by law.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 13 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">13. Third-Party Services</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA may contain links to external websites or integrate with third-party services. We are not responsible for the content, privacy practices, or terms of any third-party services. Your use of third-party services is at your own risk and subject to their respective terms and policies.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 14 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">14. Governing Law</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                These Terms shall be governed by and construed in accordance with applicable laws. Any disputes arising from these Terms or your use of the Platform shall be resolved through good-faith negotiation. If a resolution cannot be reached, disputes may be submitted to the competent courts.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 15 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">15. Changes to These Terms</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We may update these Terms from time to time to reflect changes in our Platform, practices, or legal requirements. When we make material changes, we will notify you through the Platform or via email. Your continued use of HOCKIA after the effective date of updated Terms constitutes your acceptance of the changes.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 16 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">16. Contact</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>If you have any questions about these Terms, please contact us at:</p>
              <p className="flex items-center gap-2">
                <span>📧</span>
                <a
                  href="mailto:team@inhockia.com"
                  className="text-[#8026FA] hover:text-[#924CEC] transition-colors"
                >
                  team@inhockia.com
                </a>
              </p>
            </div>
          </section>

          {/* Last Updated */}
          <div className="pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">Last updated: March 21, 2026</p>
          </div>
        </div>
      </div>
    </div>
  )
}
