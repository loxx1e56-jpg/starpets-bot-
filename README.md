# StarPets Discord Bot

A Discord bot that searches StarPets marketplace listings for secret-rarity items with high in-game earnings under a given price.

## Features

- `/deals` slash command with game picker menu
- Supports Steal a Brainrot, Adopt Me, Murder Mystery 2, and Grow a Garden
- Filters secret items by minimum earning (default 100m) and maximum price (default 1 GBP)
- Paginated results sorted by highest earning first
- Prices converted from USD to GBP

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and add your Discord bot token:
   ```
   cp .env.example .env
   ```

3. Create a bot at https://discord.com/developers/applications and paste the token into `.env`.

4. Invite the bot to your server using the OAuth2 URL generator with `bot` and `applications.commands` scopes.

5. Start the bot:
   ```
   npm start
   ```

## Usage

Type `/deals` in your server. You can optionally specify a game, minimum earning, and max price:

```
/deals game:Steal a Brainrot min-earning:100 max-price:1
```
