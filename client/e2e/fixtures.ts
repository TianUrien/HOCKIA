import { test as base, expect, Page } from '@playwright/test'

/**
 * Test fixtures and helpers for HOCKIA E2E tests
 *
 * IMPORTANT: E2E tests require REAL email addresses to avoid Supabase email bounces.
 * Set these environment variables in .env.local:
 *   - E2E_PLAYER_EMAIL (e.g., yourname+e2e-player@gmail.com)
 *   - E2E_CLUB_EMAIL (e.g., yourname+e2e-club@gmail.com)
 *   - E2E_COACH_EMAIL (e.g., yourname+e2e-coach@gmail.com)
 *   - E2E_BRAND_EMAIL (e.g., yourname+e2e-brand@gmail.com)
 *   - E2E_UMPIRE_EMAIL (e.g., yourname+e2e-umpire@gmail.com)
 *
 * Set passwords via environment variables (do not hard-code secrets in code or docs).
 */

// Validate required environment variables
function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `E2E tests require real email addresses to avoid Supabase email bounces.\n` +
      `Set ${name} in your .env.local file (e.g., yourname+e2e-player@gmail.com)`
    )
  }
  return value
}

// Test user credentials for E2E testing
export const TEST_USERS = {
  player: {
    get email() { return getRequiredEnv('E2E_PLAYER_EMAIL') },
    get password() { return getRequiredEnv('E2E_PLAYER_PASSWORD') },
    fullName: 'E2E Test Player',
    nationality: 'United Kingdom',
    baseLocation: 'London, UK',
    position: 'midfielder',
  },
  club: {
    get email() { return getRequiredEnv('E2E_CLUB_EMAIL') },
    get password() { return getRequiredEnv('E2E_CLUB_PASSWORD') },
    clubName: 'E2E Test FC',
    baseLocation: 'Manchester, UK',
    country: 'United Kingdom',
  },
  coach: {
    get email() { return getRequiredEnv('E2E_COACH_EMAIL') },
    get password() { return getRequiredEnv('E2E_COACH_PASSWORD') },
    fullName: 'E2E Test Coach',
    nationality: 'United Kingdom',
    baseLocation: 'Birmingham, UK',
    position: 'Head Coach',
  },
  brand: {
    get email() { return getRequiredEnv('E2E_BRAND_EMAIL') },
    get password() { return getRequiredEnv('E2E_BRAND_PASSWORD') },
    brandName: 'E2E Test Brand',
    slug: 'e2e-test-brand',
    category: 'equipment',
  },
  umpire: {
    get email() { return getRequiredEnv('E2E_UMPIRE_EMAIL') },
    get password() { return getRequiredEnv('E2E_UMPIRE_PASSWORD') },
    fullName: 'E2E Test Umpire',
    nationality: 'United Kingdom',
    baseLocation: 'London, UK',
    umpireLevel: 'Regional',
    federation: 'England Hockey',
    officiatingSpecialization: 'outdoor',
  },
} as const

/**
 * Page Object Model for common page interactions
 */
export class HockiaPage {
  constructor(public page: Page) {}

  // Navigation helpers
  async goto(path: string) {
    await this.page.goto(path)
  }

  async waitForNavigation() {
    await this.page.waitForLoadState('networkidle')
  }

  // Auth helpers
  async isLoggedIn() {
    // Check for presence of avatar or dashboard link
    return await this.page.locator('[aria-label="Open user menu"], [data-testid="user-avatar"]').isVisible()
  }

  async logout() {
    await this.page.locator('[aria-label="Open user menu"]').click()
    await this.page.getByRole('menuitem', { name: /sign out/i }).click()
    await this.waitForNavigation()
  }

  // Toast helpers
  async expectToast(message: string | RegExp) {
    await expect(
      this.page.locator('[role="status"], [role="alert"]').filter({ hasText: message })
    ).toBeVisible({
      timeout: 10000,
    })
  }

  async expectNoErrors() {
    await expect(this.page.locator('[role="alert"]')).not.toBeVisible()
  }

  // Loading helpers
  async waitForLoadingToComplete() {
    // Wait for any spinners to disappear
    await this.page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {
      // No spinner found, that's fine
    })
  }
}

/**
 * Page Object for Landing/Auth pages
 */
export class AuthPage extends HockiaPage {
  async clickSignUp() {
    await this.page.getByRole('link', { name: /join hockia/i }).click()
  }

  async selectRole(role: 'player' | 'coach' | 'club') {
    const roleLabels = {
      player: /i'm a player/i,
      coach: /i'm a coach/i,
      club: /i'm a club/i,
    }
    await this.page.getByRole('button', { name: roleLabels[role] }).click()
  }

  async fillSignUpForm(email: string) {
    await this.page.getByLabel(/email/i).fill(email)
    await this.page.getByRole('button', { name: /continue|sign up|get started/i }).click()
  }

  async signInWithEmail(email: string) {
    await this.page.goto('/')
    await this.page.getByLabel(/email/i).fill(email)
    await this.page.getByRole('button', { name: /sign in|continue/i }).click()
  }
}

/**
 * Page Object for Profile Completion
 */
export class ProfilePage extends HockiaPage {
  async fillPlayerProfile(data: typeof TEST_USERS.player) {
    await this.page.getByLabel(/full name/i).fill(data.fullName)
    await this.page.getByLabel(/nationality/i).fill(data.nationality)
    await this.page.getByLabel(/base location|city/i).fill(data.baseLocation)
    
    // Select position from dropdown if present
    const positionSelect = this.page.getByLabel(/position/i)
    if (await positionSelect.isVisible()) {
      await positionSelect.selectOption({ label: data.position })
    }
  }

  async fillClubProfile(data: typeof TEST_USERS.club) {
    await this.page.getByLabel(/club name|name/i).fill(data.clubName)
    await this.page.getByLabel(/location|city/i).fill(data.baseLocation)
    await this.page.getByLabel(/country/i).fill(data.country)
  }

  async submitProfile() {
    await this.page.getByRole('button', { name: /save|complete|submit|continue/i }).click()
    await this.waitForNavigation()
  }
}

/**
 * Page Object for Messaging
 */
export class MessagesPage extends HockiaPage {
  async openMessagesPage() {
    await this.page.goto('/messages')
    await this.waitForLoadingToComplete()
  }

  async selectConversation(participantName: string) {
    await this.page.getByText(participantName).click()
    await this.waitForLoadingToComplete()
  }

  async sendMessage(content: string) {
    const textarea = this.page.getByPlaceholder(/type a message/i)
    await textarea.fill(content)
    await this.page.keyboard.press('Enter')
  }

  async expectMessage(content: string) {
    await expect(this.page.locator('[data-testid="chat-message-list"]').getByText(content)).toBeVisible({
      timeout: 10000,
    })
  }

  async startNewConversation(recipientId: string) {
    await this.page.goto(`/messages?new=${recipientId}`)
    await this.waitForLoadingToComplete()
  }
}

/**
 * Page Object for Opportunities/Vacancies
 */
export class OpportunitiesPage extends HockiaPage {
  async openOpportunitiesPage() {
    await this.page.goto('/opportunities')
    await this.waitForLoadingToComplete()
  }

  async filterByLocation(location: string) {
    await this.page.getByPlaceholder(/city or country/i).fill(location)
    await this.waitForLoadingToComplete()
  }

  async openVacancyDetails(title: string) {
    await this.page.getByText(title).click()
    await this.waitForLoadingToComplete()
  }

  async applyToVacancy() {
    await this.page.getByRole('button', { name: /apply now/i }).click()
  }

  async confirmApplication(message?: string) {
    if (message) {
      await this.page.getByLabel(/message|cover letter/i).fill(message)
    }
    await this.page.getByRole('button', { name: /submit|apply|confirm/i }).click()
    await this.waitForNavigation()
  }

  async expectApplicationConfirmation() {
    await expect(
      this.page.getByText(/application submitted|applied|success/i)
    ).toBeVisible({ timeout: 10000 })
  }
}

/**
 * Page Object for Community Page
 */
export class CommunityPage extends HockiaPage {
  async openCommunityPage() {
    await this.page.goto('/community')
    await this.waitForLoadingToComplete()
  }

  async searchProfiles(query: string) {
    await this.page.getByPlaceholder(/search/i).fill(query)
    await this.waitForLoadingToComplete()
  }

  async openProfile(name: string) {
    await this.page.getByText(name).click()
    await this.waitForLoadingToComplete()
  }

  async startConversation() {
    await this.page.getByRole('button', { name: /message/i }).click()
  }
}

/**
 * Page Object for Questions (Q&A) Feature
 */
export class QuestionsPage extends HockiaPage {
  async openQuestionsPage() {
    await this.page.goto('/community/questions')
    await this.waitForLoadingToComplete()
  }

  async openQuestionDetail(questionId: string) {
    await this.page.goto(`/community/questions/${questionId}`)
    await this.waitForLoadingToComplete()
  }

  async switchToQuestionsMode() {
    await this.page.goto('/community')
    await this.waitForLoadingToComplete()
    await this.page.getByRole('button', { name: /questions/i }).click()
    await this.waitForLoadingToComplete()
  }

  async switchToPeopleMode() {
    await this.page.getByRole('button', { name: /people/i }).click()
    await this.waitForLoadingToComplete()
  }

  async clickAskQuestion() {
    await this.page.getByRole('button', { name: /ask a question/i }).click()
  }

  async fillQuestionForm(title: string, category: string, body?: string) {
    await this.page.getByLabel(/title/i).fill(title)
    await this.page.getByLabel(/category/i).selectOption({ label: category })
    if (body) {
      await this.page.getByLabel(/details|body/i).fill(body)
    }
  }

  async submitQuestion() {
    await this.page.getByRole('button', { name: /post question|submit/i }).click()
  }

  async filterByCategory(category: string) {
    await this.page.locator('select').filter({ hasText: /all categories/i }).first().selectOption({ label: category })
    await this.waitForLoadingToComplete()
  }

  async sortBy(option: 'Latest' | 'Most Answered') {
    await this.page.locator('select').filter({ hasText: /latest|most answered/i }).first().selectOption({ label: option })
    await this.waitForLoadingToComplete()
  }

  async clickQuestion(title: string) {
    await this.page.getByRole('link').filter({ hasText: title }).click()
    await this.waitForLoadingToComplete()
  }

  async fillAnswerForm(body: string) {
    await this.page.getByPlaceholder(/write your answer|share your knowledge/i).fill(body)
  }

  async submitAnswer() {
    await this.page.getByRole('button', { name: /post answer|submit answer/i }).click()
  }

  async expectQuestionInList(title: string) {
    await expect(this.page.getByRole('heading', { level: 3, name: title })).toBeVisible({ timeout: 10000 })
  }

  async expectQuestionNotInList(title: string) {
    await expect(this.page.getByRole('heading', { level: 3, name: title })).not.toBeVisible({ timeout: 5000 })
  }

  async expectAnswerVisible(body: string) {
    await expect(this.page.getByText(body)).toBeVisible({ timeout: 10000 })
  }

  async expectAnswerCount(title: string, count: number) {
    const card = this.page.locator('a').filter({ hasText: title })
    const answerText = count === 1 ? '1 answer' : `${count} answers`
    await expect(card.getByText(answerText)).toBeVisible({ timeout: 10000 })
  }

  async deleteQuestion() {
    await this.page.getByRole('button', { name: /question options/i }).click()
    await this.page.getByRole('button', { name: /delete question/i }).click()
  }

  async editAnswer(oldBody: string, newBody: string) {
    const answerCard = this.page.locator('div').filter({ hasText: oldBody }).first()
    await answerCard.getByRole('button', { name: /answer options/i }).click()
    await this.page.getByRole('button', { name: /edit/i }).click()
    await this.page.getByRole('textbox').fill(newBody)
    await this.page.getByRole('button', { name: /save/i }).click()
  }

  async deleteAnswer(body: string) {
    const answerCard = this.page.locator('div').filter({ hasText: body }).first()
    await answerCard.getByRole('button', { name: /answer options/i }).click()
    await this.page.getByRole('button', { name: /delete/i }).click()
  }

  async getQuestionIdFromUrl(): Promise<string> {
    const url = this.page.url()
    const match = url.match(/\/community\/questions\/([a-f0-9-]+)/)
    return match ? match[1] : ''
  }
}

/**
 * Page Object for Home Feed
 */
export class HomeFeedPage extends HockiaPage {
  async openHomeFeed() {
    await this.page.goto('/home')
    await this.waitForLoadingToComplete()
  }

  async expectPostComposerVisible() {
    await expect(this.page.getByText('Start a post...')).toBeVisible({ timeout: 10000 })
  }

  async expectPostComposerHidden() {
    await expect(this.page.getByText('Start a post...')).not.toBeVisible({ timeout: 5000 })
  }

  async openPostComposer() {
    await this.page.getByText('Start a post...').click()
  }

  async fillPostContent(content: string) {
    // Locate by role rather than placeholder copy — placeholders rotate
    // per role (pickPlaceholder) so a fixed regex is brittle.
    await this.page.locator('[role="dialog"] textarea').first().fill(content)
  }

  async submitPost() {
    // Target the full-width submit button (not the mode toggle "Post" tab)
    await this.page.locator('button.w-full', { hasText: /^post$/i }).click()
  }

  async expectPostInFeed(content: string) {
    await expect(this.page.getByText(content).first()).toBeVisible({ timeout: 15000 })
  }

  async clickLikeOnPost(content: string) {
    const postCard = this.page.locator('div').filter({ hasText: content }).first()
    await postCard.getByRole('button', { name: /like/i }).click()
  }

  async clickCommentOnPost(content: string) {
    const postCard = this.page.locator('div').filter({ hasText: content }).first()
    await postCard.getByRole('button', { name: /comment/i }).click()
  }

  async clickShareOnPost(content: string) {
    const postCard = this.page.locator('div').filter({ hasText: content }).first()
    await postCard.getByRole('button', { name: /share/i }).click()
  }

  async addCommentToPost(commentText: string) {
    await this.page.getByPlaceholder(/write a comment/i).fill(commentText)
    await this.page.getByRole('button', { name: /send/i }).click()
  }

  async expectCommentVisible(commentText: string) {
    await expect(this.page.getByText(commentText)).toBeVisible({ timeout: 10000 })
  }
}

/**
 * Page Object for Notification Drawer
 *
 * The drawer uses CSS transforms (translate-x-0 / translate-x-full) to show/hide,
 * so Playwright's isVisible() always returns true since the element is in the DOM
 * with non-zero dimensions. We check the `translate-x-0` class instead.
 */
export class NotificationsPage extends HockiaPage {
  get drawer() {
    return this.page.locator('[role="dialog"][aria-label="Notifications"]')
  }

  /** The drawer element with the "open" transform class. */
  get openDrawerLocator() {
    return this.page.locator('[role="dialog"][aria-label="Notifications"].translate-x-0')
  }

  get bellButton() {
    // exact:true prevents matching "Search notifications" / "Close notifications"
    return this.page.getByRole('button', { name: 'Notifications', exact: true })
  }

  /** Check if the drawer is currently in the open (translate-x-0) state. */
  async isDrawerOpen(): Promise<boolean> {
    const count = await this.openDrawerLocator.count()
    return count > 0
  }

  async openDrawer() {
    // Drawer may already be open (e.g. auto-opened by unread notifications)
    if (await this.isDrawerOpen()) return
    await this.bellButton.click()
    await expect(this.openDrawerLocator).toBeVisible({ timeout: 5000 })
  }

  async closeDrawer() {
    if (!(await this.isDrawerOpen())) return
    // Use Escape key — the close button can be outside viewport in fixed drawers
    await this.page.keyboard.press('Escape')
    await expect(this.openDrawerLocator).not.toBeVisible({ timeout: 5000 })
  }

  async expectNotification(textPattern: string | RegExp, options?: { timeout?: number }) {
    // Use .first() because multiple notifications may match (e.g. from previous runs)
    await expect(this.openDrawerLocator.getByText(textPattern).first()).toBeVisible({
      timeout: options?.timeout ?? 15000,
    })
  }

  async expectNoNotification(textPattern: string | RegExp) {
    await expect(this.openDrawerLocator.getByText(textPattern)).not.toBeVisible({ timeout: 5000 })
  }

  async clickNotification(textPattern: string | RegExp) {
    await this.openDrawerLocator.locator('[role="button"]').filter({ hasText: textPattern }).click()
  }

  async expectBadgeVisible() {
    await expect(this.page.locator('[role="status"]')).toBeVisible({ timeout: 10000 })
  }
}

/**
 * Page Object for Brand Dashboard & Brand Pages
 */
export class BrandsPage extends HockiaPage {
  async openBrandsDirectory() {
    await this.page.goto('/brands')
    await this.waitForLoadingToComplete()
  }

  async openBrandProfile(slug: string) {
    await this.page.goto(`/brands/${slug}`)
    await this.waitForLoadingToComplete()
  }

  async openBrandDashboard() {
    await this.page.goto('/dashboard/brand')
    await this.waitForLoadingToComplete()
  }

  async switchTab(tab: 'Overview' | 'Products' | 'Posts' | 'Messages' | 'Followers') {
    await this.page.getByRole('button', { name: tab }).click()
    await this.waitForLoadingToComplete()
  }

  async switchDirectoryView(view: 'Feed' | 'Directory') {
    await this.page.getByRole('button', { name: view }).click()
    await this.waitForLoadingToComplete()
  }

  async clickAddProduct() {
    await this.page.getByRole('button', { name: /add product/i }).click()
  }

  async clickNewPost() {
    await this.page.getByRole('button', { name: /new post/i }).click()
  }

  async fillProductForm(name: string, description?: string) {
    await this.page.locator('#product-name').fill(name)
    if (description) {
      await this.page.locator('#product-description').fill(description)
    }
  }

  async fillPostForm(content: string) {
    await this.page.locator('#post-content').fill(content)
  }

  async submitProductForm() {
    await this.page.getByRole('button', { name: /add product|save changes/i }).click()
  }

  async submitPostForm() {
    await this.page.getByRole('button', { name: /publish post|save changes/i }).click()
  }
}

/**
 * Extended test fixture with page objects
 */
export const test = base.extend<{
  authPage: AuthPage
  profilePage: ProfilePage
  messagesPage: MessagesPage
  opportunitiesPage: OpportunitiesPage
  communityPage: CommunityPage
  questionsPage: QuestionsPage
  brandsPage: BrandsPage
  homeFeedPage: HomeFeedPage
  notificationsPage: NotificationsPage
}>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page))
  },
  profilePage: async ({ page }, use) => {
    await use(new ProfilePage(page))
  },
  messagesPage: async ({ page }, use) => {
    await use(new MessagesPage(page))
  },
  opportunitiesPage: async ({ page }, use) => {
    await use(new OpportunitiesPage(page))
  },
  communityPage: async ({ page }, use) => {
    await use(new CommunityPage(page))
  },
  questionsPage: async ({ page }, use) => {
    await use(new QuestionsPage(page))
  },
  brandsPage: async ({ page }, use) => {
    await use(new BrandsPage(page))
  },
  homeFeedPage: async ({ page }, use) => {
    await use(new HomeFeedPage(page))
  },
  notificationsPage: async ({ page }, use) => {
    await use(new NotificationsPage(page))
  },
})

export { expect }
