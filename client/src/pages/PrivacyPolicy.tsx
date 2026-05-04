import { Shield, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function PrivacyPolicy() {
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
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
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
                Welcome to HOCKIA ("we", "us", "our"). We respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, and safeguard your information when you use our platform, available at inhockia.com, as a Progressive Web App (PWA), and through our native mobile applications for iOS and Android (collectively, "the Platform").
              </p>
              <p>
                By creating an account or using any part of the Platform, you agree to the collection and use of information as described in this Privacy Policy. If you do not agree, please do not use HOCKIA.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 2 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>We collect the following categories of information:</p>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">2.1 Account Information</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Email address</li>
                <li>- Password (securely hashed; never stored in plain text)</li>
                <li>- Selected role (player, coach, club, or brand)</li>
                <li>- Authentication provider (email, Google, or Apple)</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">2.2 Profile Information</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Full name</li>
                <li>- Date of birth (players and coaches)</li>
                <li>- Gender</li>
                <li>- Nationality (primary and secondary)</li>
                <li>- Location (city, country)</li>
                <li>- Profile photo / avatar</li>
                <li>- Bio and personal description</li>
                <li>- Playing position (players)</li>
                <li>- Current club affiliation</li>
                <li>- Contact email (may differ from account email)</li>
                <li>- Social media links (Instagram, TikTok, Twitter/X, LinkedIn, YouTube, personal website)</li>
                <li>- Availability status</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">2.3 User-Generated Content</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Career history and journey entries (including images)</li>
                <li>- Media gallery photos and videos</li>
                <li>- Highlight video links</li>
                <li>- Messages sent to other users</li>
                <li>- Profile comments</li>
                <li>- References and endorsements</li>
                <li>- Opportunity listings</li>
                <li>- Applications to opportunities (including cover letters)</li>
                <li>- Community questions and answers</li>
                <li>- Brand posts and product listings</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">2.4 Usage and Device Data</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Device type and platform (iOS, Android, desktop)</li>
                <li>- Browser type and version</li>
                <li>- Pages visited and features used</li>
                <li>- Search queries and filters applied</li>
                <li>- Session duration and interaction patterns</li>
                <li>- PWA installation status</li>
                <li>- Push notification subscription status</li>
                <li>- Profile view analytics (who viewed your profile)</li>
                <li>- Error and crash reports</li>
              </ul>

              <p className="font-medium mt-4">
                We do not collect precise geolocation data from your device. Location information is only what you voluntarily provide in your profile (city, country).
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 3 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. How We Use Your Information</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>We use your information for the following purposes:</p>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">3.1 Platform Operation</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Create and manage your account and profile.</li>
                <li>- Authenticate your identity and maintain session security.</li>
                <li>- Enable communication between users via messaging.</li>
                <li>- Process opportunity listings and applications.</li>
                <li>- Facilitate friend connections, references, and endorsements.</li>
                <li>- Display your profile to other users of the Platform.</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">3.2 Communications</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Send transactional emails (verification, password reset, security alerts).</li>
                <li>- Send notification emails for Platform activity (messages, friend requests, applications, references, profile views).</li>
                <li>- Send email digests summarizing your notifications and activity.</li>
                <li>- Deliver push notifications for real-time updates.</li>
                <li>- Send Platform announcements and service updates.</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">3.3 Analytics and Improvement</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Understand how users interact with the Platform.</li>
                <li>- Identify and fix bugs, errors, and performance issues.</li>
                <li>- Improve features, user experience, and Platform reliability.</li>
                <li>- Track aggregate trends and usage patterns.</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4">3.4 Safety and Compliance</h3>
              <ul className="list-none space-y-2 ml-4">
                <li>- Detect and prevent fraud, abuse, and violations of our Terms.</li>
                <li>- Enforce our community standards and content policies.</li>
                <li>- Comply with legal obligations and respond to lawful requests.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 4 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Third-Party Services and Data Sharing</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We use trusted third-party services to operate and improve the Platform. These services process data on our behalf and are contractually obligated to protect your information:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li><strong>Supabase:</strong> Database hosting, user authentication, and file storage. Your data is stored in encrypted databases hosted in the European Union.</li>
                <li><strong>Google Analytics (GA4):</strong> Anonymous usage analytics to understand how the Platform is used. We track page views, feature usage, and aggregate trends. Your user ID is associated with analytics data to provide personalized insights.</li>
                <li><strong>Sentry:</strong> Error monitoring and crash reporting. When errors occur, diagnostic data (including device type, browser, and error details) is sent to Sentry to help us identify and fix issues.</li>
                <li><strong>Resend:</strong> Transactional and notification email delivery. Your email address and name are shared with Resend solely for the purpose of delivering emails from HOCKIA.</li>
                <li><strong>Web Push Services:</strong> Push notification delivery through browser APIs. Your push subscription token is stored to deliver notifications.</li>
              </ul>
              <p className="font-medium mt-4">
                We do not sell, rent, or trade your personal data to any third party. We do not share your data with advertisers.
              </p>
              <p>
                We may disclose your information if required by law, legal process, or government request, or if necessary to protect the rights, safety, or property of HOCKIA, its users, or the public.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 5 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Data Storage and Security</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                Your data is stored securely using industry-standard encryption and security practices. All data in transit is encrypted using HTTPS/TLS. Passwords are cryptographically hashed and never stored in plain text.
              </p>
              <p>
                Files (profile photos, gallery images, career history media) are stored in secure cloud storage buckets with access controls.
              </p>
              <p>
                While we implement reasonable security measures to protect your data, no system is completely secure. We cannot guarantee absolute security of your information and encourage you to use strong, unique passwords for your account.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 6 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Cookies, Local Storage, and Tracking</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA uses browser local storage (not traditional cookies) to maintain your session, store preferences, and improve your experience. The following data is stored locally on your device:
              </p>
              <ul className="list-none space-y-2 ml-4">
                <li>- Authentication session tokens (to keep you signed in).</li>
                <li>- Draft messages and form data (to prevent data loss).</li>
                <li>- Recent search queries (for convenience).</li>
                <li>- UI preferences and navigation state.</li>
                <li>- Device tracking session flag (to avoid duplicate tracking).</li>
              </ul>
              <p>
                Google Analytics uses cookies to collect anonymous usage data. You can opt out of Google Analytics by using browser extensions or privacy settings.
              </p>
              <p>
                We do not use advertising cookies or third-party tracking pixels.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 7 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Your Rights and Choices</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>You have the following rights regarding your personal data:</p>
              <ul className="list-none space-y-3 ml-4">
                <li><strong>Access:</strong> You can view and access all your personal data through your profile and Settings page at any time.</li>
                <li><strong>Correction:</strong> You can edit and update your profile information, career history, and other personal data directly on the Platform.</li>
                <li><strong>Deletion:</strong> You can permanently delete your account and all associated data through the Settings page. Upon deletion, we remove your profile, messages, applications, media files, career history, notifications, connections, references, push subscriptions, and stored files.</li>
                <li><strong>Notification preferences:</strong> You can control which notifications you receive (opportunities, applications, friend requests, references, messages, profile views) and how you receive them (email, push) through the Settings page.</li>
                <li><strong>Browse anonymously:</strong> You can enable anonymous browsing in Settings to hide your profile visits from other users' analytics.</li>
                <li><strong>Data portability:</strong> You may request a copy of your personal data by contacting us at team@inhockia.com.</li>
              </ul>
              <p>
                To exercise any of these rights, visit your Settings page or contact us at team@inhockia.com. We will respond to your request within 30 days.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 8 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Data Retention</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We retain your personal data for as long as your account is active and as needed to provide our services. When you delete your account, your personal data is permanently removed from our servers.
              </p>
              <p>
                Some data may be retained beyond account deletion in the following cases:
              </p>
              <ul className="list-none space-y-2 ml-4">
                <li>- Messages already delivered to other users may remain in their conversation history.</li>
                <li>- References and endorsements you provided to other users may persist on their profiles.</li>
                <li>- Anonymized, aggregated data that cannot identify you may be retained for analytics purposes.</li>
                <li>- Data required to be retained by law or for legal proceedings.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 9 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Children's Privacy</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA is not directed at children under 16 years of age. We do not knowingly collect personal data from children under 16 without verifiable parental consent. If we learn that we have collected personal data from a child under 16 without appropriate consent, we will take steps to delete that information promptly.
              </p>
              <p>
                If you are a parent or guardian and believe your child has provided personal data to HOCKIA without your consent, please contact us at team@inhockia.com.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 10 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. International Data Transfers</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA serves users worldwide. Your data may be transferred to and processed in countries other than your own, including countries within the European Union where our primary database is hosted. We ensure that any international data transfers comply with applicable data protection laws and that appropriate safeguards are in place.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 11 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Changes to This Policy</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or Platform features. When we make material changes, we will notify you through the Platform or via email before the changes take effect.
              </p>
              <p>
                We encourage you to review this Privacy Policy periodically. Your continued use of HOCKIA after the effective date of an updated policy constitutes your acceptance of the changes.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 12 */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Contact</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>If you have any questions, concerns, or requests regarding your privacy or this policy, please contact us at:</p>
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
