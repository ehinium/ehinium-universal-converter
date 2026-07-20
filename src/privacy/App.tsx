import { ArrowLeft, ExternalLink, Mail, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Separator } from "../components/ui/separator";

const iconUrl = `${import.meta.env.BASE_URL}icons/icon-128.png`;
const repositoryUrl = "https://github.com/ehinium/ehinium-universal-converter";
const contactEmail = "hello@ehsanrp.com";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "information-processed", label: "Information processed" },
  { id: "extension-preferences", label: "Extension preferences" },
  { id: "exchange-rate-services", label: "Exchange-rate services" },
  { id: "data-collection", label: "Data collection" },
  { id: "data-sharing", label: "Data sharing" },
  { id: "analytics-advertising", label: "Analytics and advertising" },
  { id: "remote-code", label: "Remote code" },
  { id: "data-retention", label: "Data retention" },
  { id: "security", label: "Security" },
  { id: "policy-changes", label: "Policy changes" },
  { id: "contact", label: "Contact" },
] as const;

function PolicySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <h2
        id={`${id}-title`}
        className="text-lg font-semibold leading-6 tracking-tight text-foreground"
      >
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function SectionSeparator() {
  return <Separator className="my-7" />;
}

const linkClassName =
  "rounded-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default function App() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              className="size-9 shrink-0"
              src={iconUrl}
              alt="Ehinium Universal Converter"
            />
            <div className="grid min-w-0 gap-0.5">
              <p className="truncate text-xs font-medium leading-4 text-muted-foreground">
                Ehinium Universal Converter
              </p>
              <p className="text-[22px] font-semibold leading-7 tracking-tight text-foreground">
                Privacy Policy
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={repositoryUrl}>
              <ArrowLeft aria-hidden="true" />
              Back to project
            </a>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[192px_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <nav aria-label="Privacy policy sections" className="min-w-0 lg:self-start">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">On this page</CardTitle>
              <CardDescription className="text-xs">
                Jump to a policy section.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-1 px-2 sm:grid-cols-3 lg:grid-cols-1">
              {sections.map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="min-w-0 rounded-md px-2.5 py-2 text-xs font-medium leading-4 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {label}
                </a>
              ))}
            </CardContent>
          </Card>
        </nav>

        <article className="min-w-0 w-full max-w-[780px]" aria-labelledby="policy-title">
          <Card className="policy-copy overflow-hidden">
            <CardHeader className="gap-4 border-b px-5 sm:px-6">
              <div className="grid gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-primary">
                  <ShieldCheck aria-hidden="true" className="size-4" />
                  Ehinium Universal Converter
                </div>
                <CardTitle>
                  <h1 id="policy-title" className="text-2xl leading-8 tracking-tight sm:text-[28px]">
                    Privacy Policy
                  </h1>
                </CardTitle>
                <CardDescription className="max-w-2xl leading-5">
                  This policy describes how the extension handles user data while detecting and converting supported values.
                </CardDescription>
              </div>
              <dl className="grid gap-1 rounded-lg border bg-muted/50 px-3 py-2.5 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
                <dt className="font-medium text-foreground">Last updated</dt>
                <dd className="text-muted-foreground">
                  <time dateTime="2026-07-20">July 20, 2026</time>
                </dd>
                <dt className="font-medium text-foreground">Product</dt>
                <dd className="text-muted-foreground">Ehinium Universal Converter</dd>
              </dl>
            </CardHeader>

            <CardContent className="px-5 sm:px-6">
              <PolicySection id="overview" title="Overview">
                <p>
                  Ehinium Universal Converter is a browser extension that detects supported currency and measurement values on webpages and displays converted equivalents based on the user&apos;s selected preferences.
                </p>
                <Alert className="mt-1">
                  <ShieldCheck aria-hidden="true" />
                  <AlertDescription className="leading-5 text-foreground">
                    Ehinium Universal Converter does not sell personal data, use personal data for advertising, or send webpage content to the developer.
                  </AlertDescription>
                </Alert>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="information-processed" title="Information processed by the extension">
                <p>The extension reads visible text on webpages to identify supported currencies and measurement units. This processing occurs locally inside the user&apos;s browser.</p>
                <p>Webpage text, browsing history, page titles, and visited URLs are not collected, stored, or transmitted to the developer.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="extension-preferences" title="Extension preferences">
                <p>The extension stores preferences required to provide its functionality, including:</p>
                <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
                  <li>Target currency</li>
                  <li>Preferred measurement system</li>
                  <li>Extension enabled or disabled state</li>
                  <li>Website whitelist entries</li>
                  <li>Website blacklist entries</li>
                </ul>
                <p>These settings are stored locally in the browser and are used only to operate the extension.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="exchange-rate-services" title="Exchange-rate services">
                <p>The extension retrieves global exchange rates from Frankfurter and Fawaz, and may retrieve the shared USD/IRT market rate from the Ehinium rates API.</p>
                <p>These requests retrieve shared rate data and may include currency codes or authentication required by the rate service. Currency amounts and webpage content are processed locally and are not sent to these APIs. The Ehinium rate request does not need the page text or amount being converted.</p>
                <p>Third-party services may process technical request information, such as an IP address, according to their own privacy policies.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="data-collection" title="Data collection">
                <p>Ehinium Universal Converter does not intentionally collect:</p>
                <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
                  <li>Names, email addresses, or other identifying information</li>
                  <li>Financial or payment information</li>
                  <li>Authentication credentials</li>
                  <li>Personal communications</li>
                  <li>Precise location data</li>
                  <li>Browsing history</li>
                  <li>Clicks, keystrokes, or mouse movement data</li>
                </ul>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="data-sharing" title="Data sharing">
                <p>Ehinium Universal Converter does not sell user data.</p>
                <p>User data is not shared or transferred for advertising, profiling, lending, creditworthiness, or purposes unrelated to the extension&apos;s conversion functionality.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="analytics-advertising" title="Analytics and advertising">
                <p>The current version of Ehinium Universal Converter does not use advertising trackers or third-party analytics services.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="remote-code" title="Remote code">
                <p>The extension does not download or execute remotely hosted code. All executable extension logic is included in the installed extension package.</p>
                <p>External network requests retrieve data such as exchange rates and do not retrieve executable scripts or remote application logic.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="data-retention" title="Data retention">
                <p>The developer does not retain webpage content, browsing history, or user activity data.</p>
                <p>Extension preferences remain stored in the browser until they are changed, cleared, or the extension is removed.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="security" title="Security">
                <p>The extension is designed to request only the permissions necessary to detect supported values, display conversions, retrieve exchange rates, and save user preferences.</p>
                <p>Reasonable technical measures are used to minimize unnecessary access to user data.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="policy-changes" title="Changes to this privacy policy">
                <p>This privacy policy may be updated when the extension&apos;s functionality, permissions, or data practices change.</p>
                <p>The latest version will always be published on this page with an updated revision date.</p>
              </PolicySection>

              <SectionSeparator />
              <PolicySection id="contact" title="Contact">
                <p>For privacy questions, bug reports, or support requests, contact:</p>
                <p>
                  <a className={linkClassName} href={`mailto:${contactEmail}`}>
                    <Mail aria-hidden="true" className="mr-1.5 inline size-4" />
                    {contactEmail}
                  </a>
                </p>
                <p>
                  Project repository:{" "}
                  <a className={linkClassName} href={repositoryUrl} target="_blank" rel="noopener noreferrer">
                    github.com/ehinium/ehinium-universal-converter
                    <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5" />
                  </a>
                </p>
              </PolicySection>
            </CardContent>

            <footer className="border-t px-5 py-4 text-xs text-muted-foreground sm:px-6">
              Copyright © 2026 Ehinium. All rights reserved.
            </footer>
          </Card>
        </article>
      </div>
    </main>
  );
}
