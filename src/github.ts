import { issueTitle, syncDailyIssue, type IssueRecord, type IssueStore } from "./alerts.ts";
import type { DailyBest, RankEvent } from "./types.ts";

interface GithubOptions {
  token: string;
  repository: string;
  fetchImpl?: typeof fetch;
}

export class GithubIssueStore implements IssueStore {
  private readonly token: string;
  private readonly repository: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GithubOptions) {
    this.token = options.token;
    this.repository = options.repository;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async findByTitle(title: string): Promise<IssueRecord | null> {
    const query = `repo:${this.repository} in:title "${title}"`;
    const payload = await this.request<{ items: Array<{ number: number; title: string; body: string | null }> }>(
      "GET",
      `/search/issues?q=${encodeURIComponent(query)}&per_page=10`,
      undefined,
      "https://api.github.com",
    );
    const match = payload.items.find((item) => item.title === title);
    if (!match) return null;
    return { number: match.number, body: match.body ?? "" };
  }

  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    const response = await this.raw("POST", `/repos/${this.repository}/labels`, { name, color, description });
    if (response.status === 201 || response.status === 422) return;
    const text = await response.text();
    throw new Error(`Unable to ensure label ${name}: ${response.status} ${text}`);
  }

  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<IssueRecord> {
    const created = await this.request<{ number: number; body: string | null }>(
      "POST",
      `/repos/${this.repository}/issues`,
      input,
    );
    return { number: created.number, body: created.body ?? input.body };
  }

  async updateIssue(number: number, input: { body: string; labels: string[] }): Promise<void> {
    await this.request("PATCH", `/repos/${this.repository}/issues/${number}`, input);
  }

  async listComments(number: number): Promise<Array<{ body: string }>> {
    const comments: Array<{ body: string }> = [];
    for (let page = 1; page <= 5; page += 1) {
      const batch = await this.request<Array<{ body: string }>>(
        "GET",
        `/repos/${this.repository}/issues/${number}/comments?per_page=100&page=${page}`,
      );
      comments.push(...batch.map((comment) => ({ body: comment.body ?? "" })));
      if (batch.length < 100) break;
    }
    return comments;
  }

  async createComment(number: number, body: string): Promise<void> {
    await this.request("POST", `/repos/${this.repository}/issues/${number}/comments`, { body });
  }

  private async request<T>(method: string, pathname: string, body?: unknown, origin = "https://api.github.com"): Promise<T> {
    const response = await this.raw(method, pathname, body, origin);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub API ${method} ${pathname} failed: ${response.status} ${text}`);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private raw(method: string, pathname: string, body?: unknown, origin = "https://api.github.com"): Promise<Response> {
    return this.fetchImpl(`${origin}${pathname}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "github-trending-tracker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

export async function publishAlerts(input: {
  token: string;
  repository: string;
  date: string;
  bests: DailyBest[];
  events: RankEvent[];
  fetchImpl?: typeof fetch;
}): Promise<{ issueNumber: number | null; notified: string[] }> {
  const store = new GithubIssueStore(input);
  const result = await syncDailyIssue(store, {
    date: input.date,
    bests: input.bests,
    events: input.events,
  });
  if (result.issueNumber) {
    console.log(`Updated ${issueTitle(input.date)} (#${result.issueNumber})`);
  }
  return result;
}
