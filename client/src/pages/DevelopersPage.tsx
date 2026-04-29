import { ArrowLeft, Code2, Globe, Shield, Zap, ExternalLink, Copy, Check } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'

// API base URL - Supabase Edge Function
const API_BASE_URL = 'https://xtertgftujnebubxgqit.supabase.co/functions/v1'

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <pre className={`bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm font-mono language-${language}`}>
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-400" />
        ) : (
          <Copy className="w-4 h-4 text-gray-300" />
        )}
      </button>
    </div>
  )
}

function JsonBlock({ json }: { json: object }) {
  const [copied, setCopied] = useState(false)
  const jsonString = JSON.stringify(json, null, 2)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm font-mono max-h-80 overflow-y-auto">
        <code>{jsonString}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-400" />
        ) : (
          <Copy className="w-4 h-4 text-gray-300" />
        )}
      </button>
    </div>
  )
}

export default function DevelopersPage() {
  const navigate = useNavigate()

  const exampleResponse = {
    data: [
      {
        id: "abc-123-def-456",
        title: "Goalkeeper - Women's First Team",
        opportunity_type: "player",
        position: "goalkeeper",
        gender: "Women",
        location: { city: "Zürich", country: "Switzerland" },
        start_date: "2025-08-01",
        application_deadline: "2025-03-20",
        priority: "high",
        requirements: ["5+ years experience", "International level preferred"],
        benefits: ["housing", "visa", "flights"],
        club: {
          name: "HC Zürich",
          logo_url: "https://example.com/logo.png",
          location: "Zürich, Switzerland",
          league: "National League A"
        },
        apply_url: "https://inhockia.com/opportunities/abc-123-def-456"
      }
    ],
    meta: {
      total: 47,
      limit: 20,
      offset: 0,
      has_more: true
    }
  }

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

        {/* Hero Section */}
        <div className="bg-gradient-to-br from-[#8026FA] to-[#924CEC] rounded-2xl shadow-lg p-8 md:p-12 mb-8 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Code2 className="w-6 h-6" />
            </div>
            <span className="text-white/80 text-sm font-medium uppercase tracking-wide">Public API</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            HOCKIA for AI & Developers
          </h1>
          <p className="text-lg text-white/90 max-w-2xl">
            Discover field hockey opportunities programmatically. Built for AI assistants, job platforms, and integrations.
          </p>
        </div>

        {/* Content */}
        <div className="space-y-8">
          
          {/* What is HOCKIA */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Globe className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">What is HOCKIA?</h2>
              </div>
            </div>
            <div className="text-gray-700 leading-relaxed space-y-4">
              <p>
                <strong>HOCKIA</strong> is the home of field hockey — a platform where players, coaches, and clubs connect.
                Clubs post opportunities, and players from around the world discover and apply to join their teams.
              </p>
              <p>
                We believe the future of discovery is AI-first. That's why we've opened a <strong>public API</strong> that 
                lets AI assistants, job aggregators, and developers surface HOCKIA opportunities to their users — safely and responsibly.
              </p>
            </div>
          </section>

          {/* What Can You Access */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Public Opportunities API</h2>
              </div>
            </div>
            <div className="text-gray-700 leading-relaxed space-y-4">
              <p>
                Our public API provides <strong>read-only access</strong> to open field hockey opportunities — 
                positions that clubs have published and want to fill.
              </p>
              <p className="font-medium">This includes:</p>
              <ul className="list-none space-y-2 ml-4">
                <li>• Position title and type (player or coach)</li>
                <li>• Location (city and country)</li>
                <li>• Team category (Adult Men, Adult Women, Girls, Boys, Mixed)</li>
                <li>• Requirements and benefits offered</li>
                <li>• Club name and logo</li>
                <li>• Application deadline and start date</li>
              </ul>
              
              {/* Privacy emphasis */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mt-6">
                <p className="text-blue-900 font-medium mb-2">🔒 Your privacy is protected</p>
                <p className="text-blue-800 text-sm">
                  HOCKIA <strong>never</strong> exposes player profiles, applications, messages, or any personal contact details
                  through this public API. Only open, club-published opportunities are available, and all sensitive
                  user data remains protected inside HOCKIA.
                </p>
              </div>
            </div>
          </section>

          {/* Quick Start */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Quick Start</h2>
              </div>
            </div>
            <div className="space-y-6">
              <div>
                <p className="text-gray-700 mb-3 font-medium">List all open opportunities:</p>
                <CodeBlock code={`curl "${API_BASE_URL}/public-opportunities"`} />
              </div>
              <div>
                <p className="text-gray-700 mb-3 font-medium">Find goalkeeper positions in the Netherlands:</p>
                <CodeBlock code={`curl "${API_BASE_URL}/public-opportunities?position=goalkeeper&country=Netherlands"`} />
              </div>
              <div>
                <p className="text-gray-700 mb-3 font-medium">Get a specific opportunity by ID:</p>
                <CodeBlock code={`curl "${API_BASE_URL}/public-opportunities/{id}"`} />
              </div>
            </div>
          </section>

          {/* Filters & Response - Two columns on desktop */}
          <div className="grid md:grid-cols-2 gap-8">
            {/* Filters */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Filters & Pagination</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-4 font-medium text-gray-900">Parameter</th>
                      <th className="text-left py-2 font-medium text-gray-900">Values</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono text-purple-600">position</td>
                      <td className="py-2">goalkeeper, defender, midfielder, forward</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono text-purple-600">gender</td>
                      <td className="py-2">Men, Women, Girls, Boys, Mixed</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono text-purple-600">country</td>
                      <td className="py-2">Country name (e.g., Netherlands)</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono text-purple-600">opportunity_type</td>
                      <td className="py-2">player, coach</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono text-purple-600">priority</td>
                      <td className="py-2">high, medium, low</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono text-purple-600">limit</td>
                      <td className="py-2">1–100 (default: 20)</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-mono text-purple-600">offset</td>
                      <td className="py-2">Pagination offset</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Response Format */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Response Format</h2>
              <p className="text-gray-700 text-sm mb-4">
                Responses are JSON. Each opportunity includes an <code className="bg-gray-100 px-1.5 py-0.5 rounded text-purple-600">apply_url</code> that 
                links directly to HOCKIA — users must visit HOCKIA to apply.
              </p>
              <JsonBlock json={exampleResponse} />
            </section>
          </div>

          {/* Rate Limits */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Rate Limits & Usage</h2>
            <ul className="list-none space-y-2 text-gray-700 mb-4">
              <li>• <strong>60 requests per minute</strong> per IP address</li>
              <li>• <strong>500 requests per hour</strong> per IP address</li>
              <li>• Responses are cached for up to <strong>5 minutes</strong></li>
            </ul>
            <p className="text-gray-600 text-sm">
              This API is public, read-only, and provided as-is. We reserve the right to change or limit 
              access at any time. Please be respectful — don't scrape aggressively.
            </p>
            <p className="text-gray-600 text-sm mt-3">
              Use of this API is subject to{' '}
              <Link to="/terms" className="text-purple-600 hover:text-purple-700 underline underline-offset-2">
                HOCKIA's Terms of Use
              </Link>.
            </p>
          </section>

          {/* For AI Platforms */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">For AI Assistants & Plugins</h2>
            <p className="text-gray-700 mb-6">
              Building an AI assistant or plugin? We've prepared resources for you:
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <a
                href="/api/openapi.json"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors group"
              >
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Code2 className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">OpenAPI Specification</p>
                  <p className="text-sm text-gray-500">Full API schema for programmatic use</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-purple-600 transition-colors" />
              </a>
              <a
                href="/.well-known/ai-plugin.json"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors group"
              >
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">AI Plugin Manifest</p>
                  <p className="text-sm text-gray-500">For OpenAI and compatible ecosystems</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-green-600 transition-colors" />
              </a>
            </div>
            <p className="text-gray-600 text-sm mt-6">
              If you're integrating HOCKIA into a conversational AI, we recommend surfacing opportunities
              with clear links back to HOCKIA so users can apply.
            </p>
          </section>

          {/* Using with ChatGPT */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Using HOCKIA with ChatGPT</h2>
              </div>
            </div>
            <p className="text-gray-700 mb-4">
              You can create a Custom GPT that searches HOCKIA opportunities. Here's how:
            </p>
            <ol className="list-decimal list-inside space-y-3 text-gray-700 mb-6">
              <li>
                <strong>Create a Custom GPT</strong> in ChatGPT (requires ChatGPT Plus or Enterprise).
              </li>
              <li>
                <strong>Go to the "Actions" tab</strong> in your GPT configuration.
              </li>
              <li>
                <strong>Click "Import from URL"</strong> and paste:
                <div className="mt-2 mb-2">
                  <code className="block bg-gray-100 px-4 py-2 rounded-lg text-purple-600 text-sm break-all">
                    https://inhockia.com/api/openapi.json
                  </code>
                </div>
              </li>
              <li>
                <strong>ChatGPT will import the API</strong> and create an action for <code className="bg-gray-100 px-1.5 py-0.5 rounded text-purple-600">GET /public-opportunities</code>.
              </li>
              <li>
                <strong>Test your GPT</strong> with queries like:
                <ul className="list-disc list-inside ml-4 mt-2 text-gray-600">
                  <li>"Find me defender positions in Italy"</li>
                  <li>"Show high-priority goalkeeper opportunities"</li>
                  <li>"What coaching opportunities are available in the Netherlands?"</li>
                </ul>
              </li>
            </ol>
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              <p className="text-emerald-900 text-sm">
                <strong>Tip:</strong> In your GPT's instructions, tell it to always include the <code className="bg-emerald-100 px-1 py-0.5 rounded">apply_url</code> so 
                users can visit HOCKIA to apply for opportunities.
              </p>
            </div>
          </section>

          {/* Contact */}
          <section className="bg-gray-100 rounded-2xl p-8 text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Questions?</h2>
            <p className="text-gray-600 mb-4">
              If you're building something interesting with HOCKIA data, we'd love to hear about it.
            </p>
            <a
              href="mailto:team@inhockia.com"
              className="inline-flex items-center gap-2 text-purple-600 hover:text-purple-700 font-medium"
            >
              team@inhockia.com
              <ExternalLink className="w-4 h-4" />
            </a>
          </section>

          {/* Technical note */}
          <p className="text-center text-gray-500 text-sm">
            This API is powered by Supabase Edge Functions.
          </p>

        </div>
      </div>
    </div>
  )
}
