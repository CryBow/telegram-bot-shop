// const bot = new Telegraf('7687730781:AAFd1lhjOGFPuakDfT_rba1OtfK8xJdDeKM');
// bot.use(session()); // <-- теперь будет работать


// // Подключение к БД
// function dbClient() {
//   return new Client({
//     user: 'postgres',
//     host: 'localhost',
//     database: 'supermarket',
//     password: '1234',
//     port: 5432,
//   });
// }


// const { Telegraf, session } = require('telegraf');
// const { Client } = require('pg');

// const bot = new Telegraf('7687730781:AAFd1lhjOGFPuakDfT_rba1OtfK8xJdDeKM');
// bot.use(session()); // <-- теперь будет работать


// // Подключение к БД
// function dbClient() {
//   return new Client({
//     user: 'postgres',
//     host: 'localhost',
//     database: 'supermarket',
//     password: '1234',
//     port: 5432,
//   });
// }

// app.js

const { Telegraf, session, Markup } = require('telegraf');
const { Client } = require('pg');
const express = require('express');
const app = express();
const PORT = 3000;

const bot = new Telegraf('7687730781:AAFd1lhjOGFPuakDfT_rba1OtfK8xJdDeKM');
bot.use(session());

app.use(express.static('public'));

// Гарантируем, что объект сессии существует и инициализируем корзину
bot.use((ctx, next) => {
  if (!ctx.session) {
    ctx.session = {};
  }
  if (!ctx.session.cart) {
    ctx.session.cart = [];
  }
  return next();
});

// Конфигурация БД
const dbConfig = {
  user: 'postgres',
  host: 'localhost',
  database: 'supermarket',
  password: '1234',
  port: 5432,
};

function dbClient() {
  return new Client(dbConfig);
}

// Главное меню (inline клавиатура)
const mainMenu = Markup.inlineKeyboard([
  [{ text: '🔍 Поиск товара', callback_data: 'search' }],
  [{ text: '🛒 Каталог товаров', callback_data: 'catalog' }],
  [{ text: '👤 Личный кабинет', callback_data: 'profile' }],
  [{ text: '/restart', callback_data: 'restart' }]
]);

// /start – отправляем главное меню
bot.start((ctx) => {
  ctx.reply('👋 Привет! Я бот интернет-магазина. Выберите действие:', mainMenu);
});

// Обработка команды "/restart"
bot.action('restart', (ctx) => {
  ctx.session = {}; // сброс сессии
  ctx.reply('Чат перезапущен.', mainMenu);
  ctx.answerCbQuery();
});

// =======================
// Функционал "Поиск товара"
// =======================
bot.action('search', async (ctx) => {
  await ctx.reply('Введите слово для поиска товара:');
  ctx.session.waitingForSearch = true;
  ctx.answerCbQuery();
});

// Обработка текстовых сообщений для поиска
bot.on('text', async (ctx) => {
  const client = dbClient();
  await client.connect();
  try {
    const text = ctx.message.text.trim();
    if (ctx.session?.waitingForSearch) {
      ctx.session.waitingForSearch = false;
      const res = await client.query(
        `SELECT * FROM "Товар" WHERE LOWER("Название_товара") LIKE $1 OR LOWER("Описание") LIKE $1`,
        [`%${text.toLowerCase()}%`]
      );
      if (res.rows.length === 0) {
        await ctx.reply('❌ По вашему запросу ничего не найдено.');
      } else {
        const list = res.rows.map(t =>
          `🔸 <b>${t.Название_товара}</b>\n${t.Описание}\n💵 ${t.Цена} ₽`
        ).join('\n\n');
        await ctx.replyWithHTML(`🔍 <b>Результаты поиска:</b>\n\n${list}`);
      }
    }
  } catch (err) {
    console.error('Ошибка при поиске:', err);
    ctx.reply('Произошла ошибка при выполнении поиска.');
  } finally {
    await client.end();
  }
});

// =======================
// Функционал "Каталог товаров" – карточка товара с навигацией inline
// =======================
bot.action('catalog', async (ctx) => {
  const client = dbClient();
  await client.connect();
  try {
    const result = await client.query('SELECT * FROM "Товар" LIMIT 10');
    if (result.rows.length === 0) {
      await ctx.reply('Каталог пуст.');
    } else {
      ctx.session.catalog = result.rows;
      ctx.session.catalogIndex = 0;
      await updateCatalogMessage(ctx);
    }
  } catch (err) {
    console.error('Ошибка при получении каталога:', err);
    ctx.reply('Ошибка при получении каталога товаров.');
  } finally {
    await client.end();
  }
  ctx.answerCbQuery();
});

async function updateCatalogMessage(ctx) {
  const catalog = ctx.session.catalog;
  const catalogIndex = ctx.session.catalogIndex;
  const product = catalog[catalogIndex];
  // Формируем абсолютный URL для изображения:
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const imageUrl = `${baseUrl}/${product.Изображение}`;
  
  // Пробуем отправить фото товара:
  try {
    await ctx.replyWithPhoto({ url: imageUrl });
  } catch (err) {
    console.error('Ошибка отправки фото:', err);
    // Если ошибка, можно отправить текстовое сообщение вместо фото
    await ctx.reply(`Фото не удалось загрузить: ${imageUrl}`);
  }
  
  const msg = `<b>${product.Название_товара}</b>\n${product.Описание}\n💰 ${product.Цена} ₽`;
  
  // Формируем inline-клавиатуру для навигации и добавления товара:
  let leftBtn = (catalogIndex > 0) ? Markup.button.callback('<', 'prev') : Markup.button.callback(' ', 'none');
  let rightBtn = (catalogIndex < catalog.length - 1) ? Markup.button.callback('>', 'next') : Markup.button.callback(' ', 'none');
  
  const keyboard = Markup.inlineKeyboard([
    [leftBtn, Markup.button.callback('Добавить в корзину', `add_${product.id_Товара}`), rightBtn],
    [Markup.button.callback('Назад', 'back')]
  ]);
  
  await ctx.replyWithHTML(msg, keyboard);
}

// Функция обновления сообщения каталога
// async function updateCatalogMessage(ctx) {
//   const catalog = ctx.session.catalog;
//   const catalogIndex = ctx.session.catalogIndex;
//   const product = catalog[catalogIndex];
//   // Формируем путь для изображения (добавляем слэш перед путем, если нужно)


// const baseUrl = 'http://localhost:3000';  // или взять из environment, например process.env.BASE_URL
// const imageUrl = `${baseUrl}/${product.Изображение}`;
// await ctx.replyWithPhoto({ url: imageUrl }).catch(err => console.error('Ошибка отправки фото:', err));

//   // const imageUrl = '/' + product.Изображение;
  
//   // Отправляем фото товара (с картинкой)
//   // Если бот позволяет редактировать сообщение с фото, можно использовать editMessageMedia, но проще отправим два сообщения:
//   // await ctx.replyWithPhoto({ url: imageUrl }).catch(err => console.error('Ошибка отправки фото:', err));
  
//   const msg = `<b>${product.Название_товара}</b>\n${product.Описание}\n💰 ${product.Цена} ₽`;
  
//   // Формируем inline клавиатуру
//   let leftBtn = (catalogIndex > 0) ? Markup.button.callback('<', 'prev') : Markup.button.callback(' ', 'none');
//   let rightBtn = (catalogIndex < catalog.length - 1) ? Markup.button.callback('>', 'next') : Markup.button.callback(' ', 'none');
  
//   const keyboard = Markup.inlineKeyboard([
//     [leftBtn, Markup.button.callback('Добавить в корзину', `add_${product.id_Товара}`), rightBtn],
//     [Markup.button.callback('Назад', 'back')]
//   ]);
  
//   // Редактируем сообщение (если возможно) или отправляем новое сообщение
//   // Здесь просто отправляем новое сообщение:
//   await ctx.replyWithHTML(msg, keyboard);
// }


// Обработка кнопок "prev" и "next"
bot.action('prev', async (ctx) => {
  if (ctx.session.catalogIndex > 0) {
    ctx.session.catalogIndex--;
    await updateCatalogMessage(ctx);
  }
  ctx.answerCbQuery();
});

bot.action('next', async (ctx) => {
  if (ctx.session.catalog && ctx.session.catalogIndex < ctx.session.catalog.length - 1) {
    ctx.session.catalogIndex++;
    await updateCatalogMessage(ctx);
  }
  ctx.answerCbQuery();
});

// Обработка кнопки "Добавить в корзину"
bot.action(/^add_(\d+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const client = dbClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT * FROM "Товар" WHERE "id_Товара" = $1`,
      [productId]
    );
    if (res.rows.length === 0) {
      await ctx.reply('Товар не найден.');
    } else {
      const product = res.rows[0];
      let cart = ctx.session.cart;
      const existing = cart.find(item => item.id == product.id_Товара);
      if (existing) {
        existing.quantity++;
      } else {
        cart.push({
          id: product.id_Товара,
          name: product.Название_товара,
          price: product.Цена,
          image: product.Изображение, // например, "images/Молоко.jpg"
          quantity: 1
        });
      }
      ctx.session.cart = cart;
      await ctx.reply(`✅ Товар "${product.Название_товара}" добавлен в корзину.`);
    }
  } catch (err) {
    console.error(err);
    await ctx.reply('Ошибка при добавлении товара в корзину.');
  } finally {
    await client.end();
    ctx.answerCbQuery();
  }
});


bot.action('basket', async (ctx) => {
  if (!ctx.session.user) {
    await ctx.reply('Пожалуйста, авторизуйтесь для доступа к корзине.');
    return ctx.answerCbQuery();
  }
  let cart = ctx.session.cart || [];
  if (cart.length === 0) {
    await ctx.reply('Ваша корзина пуста.');
    return ctx.answerCbQuery();
  }
  
  let msg = '🛒 <b>Ваша корзина:</b>\n\n';
  let inlineButtons = [];
  cart.forEach(item => {
    msg += `🔹 ${item.name} — ${item.price} ₽ x ${item.quantity}\n`;
    inlineButtons.push([Markup.button.callback(`Удалить "${item.name}"`, `remove_${item.id}`)]);
  });
  inlineButtons.push([Markup.button.callback('Оформить заказ', 'checkout')]);
  inlineButtons.push([Markup.button.callback('Назад', 'back')]);

  await ctx.replyWithHTML(msg, Markup.inlineKeyboard(inlineButtons));
  ctx.answerCbQuery();
});

bot.action(/^remove_(\d+)$/, async (ctx) => {
  const productId = ctx.match[1];
  let cart = ctx.session.cart || [];
  const index = cart.findIndex(item => item.id == productId);
  if (index > -1) {
    if (cart[index].quantity > 1) {
      cart[index].quantity--;
    } else {
      cart.splice(index, 1);
    }
    ctx.session.cart = cart;
    await ctx.reply('Товар обновлён в корзине.');
  } else {
    await ctx.reply('Товар не найден в корзине.');
  }
  ctx.answerCbQuery();
});




// Обработка кнопки "Назад" – возвращаемся в главное меню
bot.action('back', (ctx) => {
  ctx.reply('Главное меню:', mainMenu);
  ctx.answerCbQuery();
});


// =======================
// Функционал личного кабинета и истории заказов (базовая реализация)
// =======================
bot.action('profile', async (ctx) => {
  if (!ctx.session.user) {
    // Если пользователь не авторизован, предлагаем вариант авторизации и регистрации
    const menu = Markup.inlineKeyboard([
      [Markup.button.callback('Авторизация', 'login')],
      [Markup.button.callback('Регистрация', 'register')],
      [Markup.button.callback('Назад', 'back')]
    ]);
    await ctx.reply('Вы не авторизованы. Выберите действие:', menu);
  } else {
    const user = ctx.session.user;
    const profileText =
      `👤 <b>Личный кабинет</b>\n\n` +
      `<b>Email:</b> ${user.email}\n` +
      `<b>Имя:</b> ${user.Имя || user.firstName}\n` +
      `<b>Фамилия:</b> ${user.Фамилия || user.lastName}\n` +
      `<b>Отчество:</b> ${user.Отчество || user.middleName}\n` +
      `<b>Телефон:</b> ${user.Телефон || user.phone}\n` +
      `<b>Адрес:</b> ${user.Адрес || user.address}\n`;
    const menu = Markup.inlineKeyboard([
      [Markup.button.callback('Корзина', 'basket')],
      [Markup.button.callback('История заказов', 'order_history')],
      [Markup.button.callback('Выйти', 'logout')],
      [Markup.button.callback('Назад', 'back')]
    ]);
    await ctx.replyWithHTML(profileText, menu);
  }
  ctx.answerCbQuery();
});


// Обработка оформления заказа (простой пример)
bot.action('checkout', async (ctx) => {
  if (!ctx.session.user) {
    await ctx.reply('Вы не авторизованы! Пожалуйста, залогиньтесь.');
    return ctx.answerCbQuery();
  }
  if (!ctx.session.cart || ctx.session.cart.length === 0) {
    await ctx.reply('Корзина пуста.');
    return ctx.answerCbQuery();
  }
  const user = ctx.session.user;
  const cart = ctx.session.cart;
  let total = 0;
  cart.forEach(item => {
    total += item.price * item.quantity;
  });
  
  const client = dbClient();
  await client.connect();
  try {
    // Создаем заказ
    const orderRes = await client.query(
      `INSERT INTO "Заказы" ("Статус_заказа", "Стоимость_заказа", "id_Пользователя")
       VALUES ('Оформлен', $1, $2) RETURNING "id_Заказа"`,
      [total, user.id_Пользователя]
    );
    const orderId = orderRes.rows[0].id_Заказа;
    
    // Создаем запись в таблице "Корзина"
    const basketRes = await client.query(
      `INSERT INTO "Корзина" ("Общая_сумма", "id_Заказа")
       VALUES ($1, $2) RETURNING "id_Корзины"`,
      [total, orderId]
    );
    const basketId = basketRes.rows[0].id_Корзины;
    
    // Записываем товары в таблицу "Корзина_Товар"
    for (const item of cart) {
      await client.query(
        `INSERT INTO "Корзина_Товар" ("id_Корзины", "id_Товара", "Количество")
         VALUES ($1, $2, $3)`,
        [basketId, item.id, item.quantity]
      );
    }
    // Очищаем корзину
    ctx.session.cart = [];
    await ctx.reply('Ваш заказ успешно оформлен!');
  } catch (err) {
    console.error('Ошибка при оформлении заказа:', err);
    await ctx.reply('Ошибка при оформлении заказа.');
  } finally {
    await client.end();
    ctx.answerCbQuery();
  }
});


// Обработка кнопки "order_history" – история заказов (простой вывод)
bot.action('order_history', async (ctx) => {
  if (!ctx.session.user) {
    await ctx.reply('Вы не авторизованы! Пожалуйста, залогиньтесь.');
    return ctx.answerCbQuery();
  }
  const client = dbClient();
  await client.connect();
  try {
    const userId = ctx.session.user.id_Пользователя;
    const res = await client.query(
      `SELECT "id_Заказа", "Дата_создания", "Статус_заказа", "Стоимость_заказа"
       FROM "Заказы"
       WHERE "id_Пользователя" = $1
       ORDER BY "Дата_создания" DESC LIMIT 5`,
      [userId]
    );
    if (res.rows.length === 0) {
      await ctx.reply('У вас пока нет заказов.');
    } else {
      const list = res.rows.map(o =>
        `Заказ #${o.id_Заказа}\nДата: ${new Date(o.Дата_создания).toLocaleString()}\nСтатус: ${o.Статус_заказа}\nСумма: ${o.Стоимость_заказа} ₽`
      ).join('\n\n');
      await ctx.reply(list);
    }
  } catch (err) {
    console.error('Ошибка при получении истории заказов:', err);
    await ctx.reply('Ошибка при получении истории заказов.');
  } finally {
    await client.end();
    ctx.answerCbQuery();
  }
});



bot.action('login', (ctx) => {
  ctx.reply('Для входа перейдите по ссылке: http://yourserver.com/login');
  ctx.answerCbQuery();
});

bot.action('register', (ctx) => {
  ctx.reply('Для регистрации перейдите по ссылке: http://yourserver.com/register');
  ctx.answerCbQuery();
});


// Обработка кнопки "logout" – выход из личного кабинета
bot.action('logout', async (ctx) => {
  ctx.session.user = null;
  ctx.session.cart = [];
  await ctx.reply('Вы успешно вышли.');
  ctx.answerCbQuery();
});


bot.launch();
console.log('Бот запущен!');

