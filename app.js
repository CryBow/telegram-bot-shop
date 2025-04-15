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
  [{ text: '📖 Каталог товаров', callback_data: 'catalog' }],
  [{ text: '🛒 Корзина', callback_data: 'basket' }],
  [{ text: '👤 Личный кабинет', callback_data: 'profile' }],
  [{ text: '/restart', callback_data: 'restart' }]
]);

bot.start(async (ctx) => {
  await ctx.reply('Добро пожаловать!', Markup.removeKeyboard());
  // Затем устанавливаем новую клавиатуру
  await ctx.reply(
    'Выберите действие:',
    Markup.keyboard([
      ['/restart'], ['Главная страница']
    ]).resize()
  );
});

bot.hears('/restart', async (ctx) => {
  await ctx.reply('Бот перезапущен!', Markup.removeKeyboard());
  ctx.reply('Чат перезапущен.', mainMenu);
  await ctx.reply(
    'Выберите действие:',
    Markup.keyboard([
      ['/restart'], ['Главная страница']
    ]).resize()
  );
});

bot.hears('Главная страница', async (ctx) => {
  await deleteLastMessage(ctx);
  ctx.reply('Главное меню:', mainMenu);
});


// Обработка команды "/restart"
bot.action('restart', (ctx) => {
  ctx.session = {}; // сброс сессии
  ctx.reply('Чат перезапущен.', mainMenu);
  ctx.answerCbQuery();
});

// Функционал "Поиск товара по артикулу"
bot.action('search', async (ctx) => {
  await ctx.reply('Введите артикул для поиска товара:');
  ctx.session.waitingForSearch = true;
  ctx.answerCbQuery();
});

// Каталог товаров
bot.action('catalog', async (ctx) => {
  await showCatalog(ctx);
  ctx.answerCbQuery();
});

async function showCatalog(ctx) {
  const client = dbClient();
  await client.connect();
  try {
    await deleteLastMessage(ctx); 
    const result = await client.query('SELECT * FROM "Товар"');
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
}


async function updateCatalogMessage(ctx) {
  const catalog = ctx.session.catalog;
  const catalogIndex = ctx.session.catalogIndex;
  const product = catalog[catalogIndex];
  const githubRawBaseUrl = 'https://raw.githubusercontent.com/CryBow/telegram-bot-shop/main/public/';
  const imagePathFromDB = product.Изображение;
  const imageUrl = encodeURI(githubRawBaseUrl + imagePathFromDB);

  // Удаляем старое сообщение, если есть
  if (ctx.session.lastMessageId) {
    try {
      await ctx.deleteMessage(ctx.session.lastMessageId);
    } catch (err) {
      console.warn('Не удалось удалить сообщение:', err.message);
    }
  }

  let sentMessage;
  try {
    sentMessage = await ctx.replyWithPhoto(
      { url: imageUrl },
      {
        caption: `<b>${product.Название_товара}</b>\n${product.Описание}\n💰 ${product.Цена} ₽`,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            catalogIndex > 0
              ? Markup.button.callback('<', 'prev')
              : Markup.button.callback(' ', 'none'),
            Markup.button.callback('➕ Добавить', `add_${product.id_Товара}`),
            catalogIndex < catalog.length - 1
              ? Markup.button.callback('>', 'next')
              : Markup.button.callback(' ', 'none')
          ],
          [Markup.button.callback('Открыть корзину', 'basket')],
          [Markup.button.callback('Назад', 'back')]
        ])
      }
    );
  } catch (err) {
    console.error('Ошибка отправки фото:', err);
    sentMessage = await ctx.reply('Фото не удалось загрузить: ' + imageUrl);
  }
  // Сохраняем ID нового сообщения
  ctx.session.lastMessageId = sentMessage.message_id;
}


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
          image: product.Изображение, 
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

//Кнопка корзины
bot.action('basket', async (ctx) => {
  await deleteLastMessage(ctx); 
  await showUserCart(ctx);
  ctx.answerCbQuery();
});

//Вызов корзины
async function showUserCart(ctx) {
  if (!ctx.session.user) {
    await ctx.reply('Пожалуйста, авторизуйтесь для доступа к корзине.');
    await showUserProfile(ctx); 
    return;
  }

  let cart = ctx.session.cart || [];
  if (cart.length === 0) {
    await ctx.reply('Ваша корзина пуста.');
    ctx.reply('Главное меню:', mainMenu);
    return;
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
}

//Удаление товара из корзины
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
    await ctx.reply('Товар удален из корзины.');
    await showUserCart(ctx);
  } else {
    await ctx.reply('Товар не найден в корзине.');
  }
  ctx.answerCbQuery();
});




// Личный кабинет
bot.action('profile', async (ctx) => {
  await deleteLastMessage(ctx); 
  await showUserProfile(ctx);
  ctx.answerCbQuery();
  
});

async function showUserProfile(ctx) {
  if (!ctx.session.user) {
    const menu = Markup.inlineKeyboard([
      [Markup.button.callback('Авторизация', 'login')],
      [Markup.button.callback('Регистрация', 'register')],
      [Markup.button.callback('Назад', 'back')]
    ]);
    await ctx.reply('Вы не авторизованы. Выберите действие:', menu);
  } else {
    const user = ctx.session.user;

    // Форматируем дату рождения
    let formattedBirthDate = '';
    if (user.Дата_Рождения || user.birthDate) {
      const date = new Date(user.Дата_Рождения || user.birthDate);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formattedBirthDate = `${day}.${month}.${year}`;
    } else {
      formattedBirthDate = '—';
    }

    const profileText =
      `👤 <b>Личный кабинет</b>\n\n` +
      `<b>Email:</b> ${user.email}\n` +
      `<b>Имя:</b> ${user.Имя || user.firstName}\n` +
      `<b>Фамилия:</b> ${user.Фамилия || user.lastName}\n` +
      `<b>Отчество:</b> ${user.Отчество || user.middleName}\n` +
      `<b>Телефон:</b> ${user.Телефон || user.phone}\n` +
      `<b>Адрес:</b> ${user.Адрес || user.address}\n` +
      `<b>Дата рождения:</b> ${formattedBirthDate}\n`;

    const menu = Markup.inlineKeyboard([
      [Markup.button.callback('История заказов', 'order_history')],
      [Markup.button.callback('Выйти', 'logout')],
      [Markup.button.callback('Назад', 'back')]
    ]);
    
    await ctx.replyWithHTML(profileText, menu);
  }
}

// Обработка оформления заказа
bot.action('checkout', async (ctx) => {
  await deleteLastMessage(ctx);
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
    await showOrderHistory(ctx);
  } catch (err) {
    console.error('Ошибка при оформлении заказа:', err);
    await ctx.reply('Ошибка при оформлении заказа.');
  } finally {
    await client.end();
    ctx.answerCbQuery();
  }
});


// Обработка кнопки история заказов
bot.action('order_history', async (ctx) => {
  await deleteLastMessage(ctx);
  await showOrderHistory(ctx);
  ctx.answerCbQuery();
});

async function showOrderHistory(ctx) {
  if (!ctx.session.user) {
    await ctx.reply('Вы не авторизованы! Пожалуйста, залогиньтесь.');
    ctx.session.fromProfile = false; 
    return;
  }
  ctx.session.fromProfile = true; 
  const client = dbClient();
  await client.connect();
  try {
    const userId = ctx.session.user.id_Пользователя;
    const res = await client.query(
      `SELECT "id_Заказа", "Дата_создания", "Статус_заказа", "Стоимость_заказа"
       FROM "Заказы"
       WHERE "id_Пользователя" = $1
       ORDER BY "Дата_создания" DESC
       LIMIT 5`,
      [userId]
    );

    if (res.rows.length === 0) {
      await ctx.reply('📝 У вас пока нет заказов.');
      ctx.session.fromProfile = false; 
      await showUserProfile(ctx);
    } else {
      const list = res.rows.map(o =>
        `📦 <b>Заказ #${o.id_Заказа}</b>\n🕓 <b>Дата:</b> ${new Date(o.Дата_создания).toLocaleString()}\n📍 <b>Статус:</b> ${o.Статус_заказа}\n💰 <b>Сумма:</b> ${o.Стоимость_заказа} ₽`
      ).join('\n\n');

      const backBtn = Markup.inlineKeyboard([[Markup.button.callback('Назад', 'back')]]);
      await ctx.replyWithHTML(list, backBtn);
    }
  } catch (err) {
    console.error('Ошибка при получении истории заказов:', err);
    await ctx.reply('❌ Ошибка при получении истории заказов.');
  } finally {
    await client.end();
  }
}





// Обработка кнопки регистрации
bot.action('register', async (ctx) => {
  ctx.session.mode = 'register';
  ctx.session.registration = {}; // Инициализируем объект для регистрации
  console.log('Начало регистрации. ctx.session.mode:', ctx.session.mode);
  await ctx.reply('Введите ваш Email для регистрации:');
  ctx.answerCbQuery();
});


// Обработка текстовых сообщений для диалогов
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  console.log('Получено текстовое сообщение:', text);
  console.log('Текущий режим:', ctx.session.mode);

  // Если режим регистрации активен, обрабатываем ввод для регистрации
  if (ctx.session.mode === 'register') {
    await handleRegistration(ctx);
    return;
  }

  // Если режим логина активен, обрабатываем ввод для входа
  if (ctx.session.mode === 'login') {
    await handleLogin(ctx);
    return;
  }

  if (ctx.session.waitingForSearch) {
    ctx.session.waitingForSearch = false;
    // Подключаемся к базе и ищем по артикулу
    const client = dbClient();
    await client.connect();
    try {
      // Ищем товары, где артикул содержит введённый текст
      const res = await client.query(
        `SELECT * FROM "Товар" WHERE LOWER("Артикул") LIKE $1`,
        [`%${text.toLowerCase()}%`]
      );
      if (res.rows.length === 0) {
        await ctx.reply('❌ По вашему запросу ничего не найдено.');
        await deleteLastMessage(ctx);
        ctx.reply('Главное меню:', mainMenu);
      } else {
        // Сохраняем найденные товары как каталог
        ctx.session.catalog = res.rows;
        ctx.session.catalogIndex = 0;
        // Вызываем функцию обновления карточки каталога
        await updateCatalogMessage(ctx);
      }
    } catch (err) {
      console.error('Ошибка при поиске по артикулу:', err);
      await ctx.reply('Произошла ошибка при выполнении поиска.');
    } finally {
      await client.end();
    }
    return;
  }
  
  // Если ни один режим не активен, можно отправить подсказку
  await ctx.reply('Пожалуйста, выберите действие из меню.');
});




//Функция регистрации
async function handleRegistration(ctx) {
  const text = ctx.message.text.trim();
  const reg = ctx.session.registration;

  // Валидации
  const isAlpha = str => /^[а-яА-Яa-zA-ZёЁ\-]+$/.test(str); 
  const isPhoneValid = str => /^\+7\d{10}$/.test(str); 
  const isEmailValid = str => /\S+@\S+\.\S+/.test(str); 
  const isBirthDateValid = str => /^\d{2}\.\d{2}\.\d{4}$/.test(str); 
  const isGenderValid = str => /^(Мужской|Женский)$/i.test(str); 


  if (!reg.email) {
    if (!isEmailValid(text)) {
      return ctx.reply('❗ Некорректный email. Пример: example@mail.ru\nВведите email:');
    }
    reg.email = text;
    return ctx.reply('Введите пароль:');
  }

  if (!reg.password) {
    reg.password = text;
    return ctx.reply('Введите Фамилию:');
  }

  if (!reg.lastName) {
    if (!isAlpha(text)) {
      return ctx.reply('❗ Фамилия должна содержать только буквы. Попробуйте снова:');
    }
    reg.lastName = text;
    return ctx.reply('Введите Имя:');
  }

  if (!reg.firstName) {
    if (!isAlpha(text)) {
      return ctx.reply('❗ Имя должно содержать только буквы. Попробуйте снова:');
    }
    reg.firstName = text;
    return ctx.reply('Введите Отчество (если нет, введите "-"):');
  }

  if (!reg.middleName) {
    if (text !== '-' && !isAlpha(text)) {
      return ctx.reply('❗ Отчество должно содержать только буквы или "-". Попробуйте снова:');
    }
    reg.middleName = (text === '-' ? '' : text);
    return ctx.reply('Введите Пол (Мужской/Женский):');
  }

  if (!reg.gender) {
    if (!isGenderValid(text)) {
      return ctx.reply('❗ Пол должен быть "Мужской" или "Женский". Введите ещё раз:');
    }
    reg.gender = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(); // нормализуем
    return ctx.reply('Введите Телефон (в формате +79999999999):');
  }

  if (!reg.phone) {
    if (!isPhoneValid(text)) {
      return ctx.reply('❗ Телефон должен быть в формате +79999999999. Введите ещё раз:');
    }
    reg.phone = text;
    return ctx.reply('Введите Адрес:');
  }

  if (!reg.address) {
    reg.address = text;
    return ctx.reply('Введите дату рождения (ДД.ММ.ГГГГ):');
  }

  if (!reg.birthDate) {
    if (!isBirthDateValid(text)) {
      return ctx.reply('❗ Некорректный формат даты. Пример: 01.01.2000\nВведите ещё раз:');
    }
    reg.birthDate = text;
    // Всё собрано — выводим сводку
    const summary = `Подтвердите регистрацию:\n\n` +
      `<b>Email:</b> ${reg.email}\n` +
      `<b>Пароль:</b> ${reg.password}\n` +
      `<b>Фамилия:</b> ${reg.lastName}\n` +
      `<b>Имя:</b> ${reg.firstName}\n` +
      `<b>Отчество:</b> ${reg.middleName || '—'}\n` +
      `<b>Пол:</b> ${reg.gender}\n` +
      `<b>Телефон:</b> ${reg.phone}\n` +
      `<b>Адрес:</b> ${reg.address}\n` +
      `<b>Дата рождения:</b> ${reg.birthDate}\n`;

    return ctx.replyWithHTML(summary,
      Markup.inlineKeyboard([
        [{ text: 'Да, всё верно', callback_data: 'register_confirm' }],
        [{ text: 'Нет, начать заново', callback_data: 'register_restart' }]
      ])
    );
  }
}

//Подтверждение регистрации
bot.action('register_confirm', async (ctx) => {
  const reg = ctx.session.registration;
  const client = dbClient();
  await client.connect();
  try {
    const query = `
      INSERT INTO "Пользователь" 
      ("Фамилия", "Имя", "Отчество", "Пол", "Телефон", "email", "Адрес", "Пароль", "Дата_Рождения")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const params = [
      reg.lastName,
      reg.firstName,
      reg.middleName || '',
      reg.gender,
      reg.phone,
      reg.email,
      reg.address,
      reg.password,
      reg.birthDate
    ];
    const result = await client.query(query, params);
    ctx.session.user = result.rows[0];  // сохраняем пользователя в сессии
    await ctx.reply('Регистрация прошла успешно! Вы авторизованы.');
    ctx.session.mode = null;
    ctx.session.registration = null;
    await showUserProfile(ctx);
  } catch (err) {
    console.error('Ошибка при регистрации:', err);
    await ctx.reply('Ошибка при регистрации. Попробуйте снова.');
  } finally {
    await client.end();
    ctx.answerCbQuery();
  }
});
// Обработка перезапуска регистрации
bot.action('register_restart', async (ctx) => {
  ctx.session.registration = {};
  await ctx.reply('Начинаем регистрацию заново. Введите ваш Email:');
  ctx.answerCbQuery();
});


// Обработка кнопки логина
bot.action('login', async (ctx) => {
  ctx.session.mode = 'login';
  ctx.session.login = {};
  console.log('Начало логина. ctx.session.mode:', ctx.session.mode);
  await ctx.reply('Введите ваш Email для входа:');
  ctx.answerCbQuery();
});


//Функция логирования
async function handleLogin(ctx) {
  const text = ctx.message.text.trim();
  const loginData = ctx.session.login;
  
  if (!loginData.email) {
    loginData.email = text;
    console.log('Логин: email установлен:', loginData.email);
    await ctx.reply('Введите пароль:');
    return;
  }
  if (!loginData.password) {
    loginData.password = text;
    // проверка учетных данных из БД
    const client = dbClient();
    await client.connect();
    try {
      const res = await client.query(
        `SELECT * FROM "Пользователь" WHERE "email" = $1`,
        [loginData.email]
      );
      if (res.rows.length === 0 || res.rows[0].Пароль !== loginData.password) {
        await ctx.reply('Неверные учетные данные. Попробуйте еще раз.');
        ctx.session.login = {}; // очищаем данные логина
      } else {
        ctx.session.user = res.rows[0];
        await ctx.reply('Вы успешно вошли в систему.');
        ctx.session.mode = null;
        ctx.session.login = null;
        await showUserProfile(ctx); 
      }
    } catch (err) {
      console.error('Ошибка при входе:', err);
      await ctx.reply('Ошибка при авторизации.');
    } finally {
      await client.end();
    }
  }
}



// Обработка кнопки назад
bot.action('back', async (ctx) => {
  await deleteLastMessage(ctx);

  if (ctx.session.fromProfile) {
    ctx.session.fromProfile = false; 
    await showUserProfile(ctx); 
  } else {
    await ctx.reply('Главное меню:', mainMenu);
  }

  await ctx.answerCbQuery();
});



// Обработка кнопки "logout" – выход из личного кабинета
bot.action('logout',async (ctx) => {
  ctx.session.user = null;
  ctx.session.cart = [];
  await deleteLastMessage(ctx);
  ctx.reply('Вы успешно вышли.');
  ctx.reply('Главное меню:', mainMenu);
  ctx.answerCbQuery();
});


// Функция удаления последнего сообщения
async function deleteLastMessage(ctx) {
  if (ctx.updateType === 'callback_query') {
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.warn('Не удалось удалить сообщение:', e.message);
    }
  }
}


const keyboard = Markup.keyboard([
  ['/restart', 'Каталог товаров'],
  ['Личный кабинет']
]).resize();

bot.launch();
console.log('Бот запущен!');

