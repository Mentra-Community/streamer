import { AuthenticatedRequest, AppServer } from '@mentra/sdk';
import express from 'express';
import path from 'path';

/**
 * Sets up all Express routes and middleware for the server
 * @param server The server instance
 */
export function setupExpressRoutes(server: AppServer): void {
  // Get the Express app instance
  const app = server.getExpressApp();

  // Set up EJS as the view engine
  app.set('view engine', 'ejs');
  app.engine('ejs', require('ejs').__express);
  app.set('views', path.join(__dirname, 'views'));

  // Register a route for handling webview requests
  app.get('/webview', (req: AuthenticatedRequest, res) => {
    if (req.authUserId) {
      // Render the webview template
      res.render('webview', {
        userId: req.authUserId,
      });
    } else {
      res.render('webview', {
        userId: undefined,
      });
    }
  });
}
