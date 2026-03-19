// TODO: legacy - candidate for removal if unused after design system refactor (not routed in App.tsx)
import { Button } from '@/components'
import { Sparkles, Zap, Rocket, Heart, Star, Code } from 'lucide-react'

export default function Showcase() {
  return (
    <div className="min-h-screen bg-dark-bg p-8">
      <div className="max-w-7xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold text-gradient">HOCKIA Design System</h1>
          <p className="text-dark-text-muted">
            A showcase of components, colors, and styles
          </p>
        </div>

        {/* Colors */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Brand Colors</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <div className="h-24 rounded-xl bg-hockia-primary" />
              <p className="text-sm text-dark-text-muted">Primary</p>
            </div>
            <div className="space-y-2">
              <div className="h-24 rounded-xl bg-hockia-secondary" />
              <p className="text-sm text-dark-text-muted">Secondary</p>
            </div>
            <div className="space-y-2">
              <div className="h-24 rounded-xl bg-hockia-accent" />
              <p className="text-sm text-dark-text-muted">Accent</p>
            </div>
            <div className="space-y-2">
              <div className="h-24 rounded-xl bg-hockia-success" />
              <p className="text-sm text-dark-text-muted">Success</p>
            </div>
            <div className="space-y-2">
              <div className="h-24 rounded-xl bg-hockia-warning" />
              <p className="text-sm text-dark-text-muted">Warning</p>
            </div>
            <div className="space-y-2">
              <div className="h-24 rounded-xl bg-hockia-danger" />
              <p className="text-sm text-dark-text-muted">Danger</p>
            </div>
          </div>
        </section>

        {/* Buttons */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Buttons</h2>
          <div className="flex flex-wrap gap-4">
            <Button variant="primary">Primary Button</Button>
            <Button variant="glass">Glass Button</Button>
            <Button variant="outline">Outline Button</Button>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary" size="lg">Large</Button>
            <Button variant="primary">
              <Rocket className="w-5 h-5 mr-2" />
              With Icon
            </Button>
          </div>
        </section>

        {/* Cards */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card">
              <Sparkles className="w-12 h-12 text-hockia-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Standard Card</h3>
              <p className="text-dark-text-muted">
                A solid card with hover effects and border styling.
              </p>
            </div>
            <div className="card-glass">
              <Zap className="w-12 h-12 text-hockia-secondary mb-4" />
              <h3 className="text-xl font-bold mb-2">Glass Card</h3>
              <p className="text-dark-text-muted">
                Beautiful glassmorphism with backdrop blur.
              </p>
            </div>
            <div className="glass-strong rounded-xl p-6">
              <Heart className="w-12 h-12 text-hockia-accent mb-4" />
              <h3 className="text-xl font-bold mb-2">Strong Glass</h3>
              <p className="text-dark-text-muted">
                Stronger glass effect with more opacity.
              </p>
            </div>
          </div>
        </section>

        {/* Inputs */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Form Elements</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
            <input
              type="text"
              placeholder="Standard input..."
              className="input"
            />
            <input
              type="email"
              placeholder="Email input..."
              className="input"
            />
            <textarea
              placeholder="Textarea..."
              rows={4}
              className="input"
            />
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4" />
                <span>Checkbox option</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="radio" className="w-4 h-4" />
                <span>Radio option 1</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="radio" className="w-4 h-4" />
                <span>Radio option 2</span>
              </label>
            </div>
          </div>
        </section>

        {/* Typography */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Typography</h2>
          <div className="space-y-4">
            <h1>Heading 1 - The quick brown fox</h1>
            <h2>Heading 2 - The quick brown fox</h2>
            <h3>Heading 3 - The quick brown fox</h3>
            <h4>Heading 4 - The quick brown fox</h4>
            <h5>Heading 5 - The quick brown fox</h5>
            <h6>Heading 6 - The quick brown fox</h6>
            <p className="text-dark-text">Body text - Regular paragraph text with normal weight.</p>
            <p className="text-dark-text-muted">Muted text - Secondary information with reduced emphasis.</p>
            <p className="text-gradient text-xl font-bold">Gradient text - Eye-catching gradient effect.</p>
          </div>
        </section>

        {/* Icons Grid */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Icons (Lucide React)</h2>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-hockia-primary/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-hockia-primary" />
              </div>
              <span className="text-xs text-dark-text-muted">Sparkles</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-hockia-secondary/20 flex items-center justify-center">
                <Zap className="w-6 h-6 text-hockia-secondary" />
              </div>
              <span className="text-xs text-dark-text-muted">Zap</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-hockia-accent/20 flex items-center justify-center">
                <Rocket className="w-6 h-6 text-hockia-accent" />
              </div>
              <span className="text-xs text-dark-text-muted">Rocket</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-hockia-success/20 flex items-center justify-center">
                <Star className="w-6 h-6 text-hockia-success" />
              </div>
              <span className="text-xs text-dark-text-muted">Star</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-hockia-warning/20 flex items-center justify-center">
                <Code className="w-6 h-6 text-hockia-warning" />
              </div>
              <span className="text-xs text-dark-text-muted">Code</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-hockia-danger/20 flex items-center justify-center">
                <Heart className="w-6 h-6 text-hockia-danger" />
              </div>
              <span className="text-xs text-dark-text-muted">Heart</span>
            </div>
          </div>
        </section>

        {/* Gradients */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Gradients</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="gradient-hockia h-32 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">.gradient-hockia</span>
            </div>
            <div className="gradient-hockia-soft h-32 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">.gradient-hockia-soft</span>
            </div>
          </div>
        </section>

        {/* Animations */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Animations</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="card-glass animate-fade-in">
              <p className="font-semibold text-center">Fade In</p>
            </div>
            <div className="card-glass animate-slide-in-up">
              <p className="font-semibold text-center">Slide Up</p>
            </div>
            <div className="card-glass animate-slide-in-down">
              <p className="font-semibold text-center">Slide Down</p>
            </div>
            <div className="card-glass animate-scale-in">
              <p className="font-semibold text-center">Scale In</p>
            </div>
          </div>
        </section>

        {/* Loading States */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">Loading States</h2>
          <div className="space-y-4">
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-3/4" />
            <div className="skeleton h-12 w-1/2" />
          </div>
        </section>
      </div>
    </div>
  )
}
